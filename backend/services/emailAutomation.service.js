const mongoose = require('mongoose');

const {
  sendWelcomeEmail,
  sendTransactionEmail,
  sendKycEmail,
  sendWithdrawalEmail,
  sendEmpowermentEmail,
  sendSecurityEmail,
} = require('./email.service');

let watcher = null;
let starting = false;

const text = (value) =>
  value === undefined || value === null
    ? ''
    : String(value);

const normalizeStatus = (value) =>
  text(value || 'PENDING').trim().toUpperCase();

const firstValue = (...values) =>
  values.find(
    (value) =>
      value !== undefined &&
      value !== null &&
      text(value).trim() !== ''
  );

const getEmailFromDoc = (doc = {}) =>
  firstValue(
    doc.email,
    doc.userEmail,
    doc.customerEmail,
    doc.beneficiaryEmail,
    doc.applicantEmail,
    doc.recipientEmail,
    doc?.user?.email,
    doc?.customer?.email,
    doc?.beneficiary?.email,
    doc?.applicant?.email
  );

const getNameFromDoc = (doc = {}) =>
  firstValue(
    doc.fullName,
    doc.name,
    doc.customerName,
    doc.userName,
    doc.beneficiaryName,
    doc.applicantName,
    doc?.user?.fullName,
    doc?.user?.name,
    doc?.customer?.fullName,
    doc?.beneficiary?.fullName,
    doc?.applicant?.fullName,
    'ServicePay Customer'
  );

const getUserReference = (doc = {}) =>
  firstValue(
    doc.userId,
    doc.user,
    doc.customerId,
    doc.customer,
    doc.ownerId,
    doc.owner,
    doc.beneficiaryId,
    doc.beneficiary,
    doc.applicantId,
    doc.applicant,
    doc.createdBy
  );

const asObjectId = (value) => {
  try {
    if (!value) return null;

    if (
      typeof value === 'object' &&
      value._id
    ) {
      value = value._id;
    }

    if (
      mongoose.Types.ObjectId.isValid(
        String(value)
      )
    ) {
      return new mongoose.Types.ObjectId(
        String(value)
      );
    }

    return null;
  } catch (_) {
    return null;
  }
};

const resolveUser = async (doc = {}) => {
  const directEmail = getEmailFromDoc(doc);

  if (directEmail) {
    return {
      email: directEmail,
      name: getNameFromDoc(doc),
    };
  }

  const ref = asObjectId(
    getUserReference(doc)
  );

  if (!ref) {
    return {
      email: null,
      name: getNameFromDoc(doc),
    };
  }

  try {
    const db = mongoose.connection.db;

    if (!db) {
      return {
        email: null,
        name: getNameFromDoc(doc),
      };
    }

    const user = await db
      .collection('users')
      .findOne(
        { _id: ref },
        {
          projection: {
            email: 1,
            fullName: 1,
            name: 1,
          },
        }
      );

    return {
      email: user?.email || null,
      name:
        user?.fullName ||
        user?.name ||
        getNameFromDoc(doc),
    };
  } catch (error) {
    console.error(
      '[EMAIL AUTO] User lookup failed:',
      error.message
    );

    return {
      email: null,
      name: getNameFromDoc(doc),
    };
  }
};

const changedKeys = (change) => {
  const fields =
    change?.updateDescription
      ?.updatedFields || {};

  return Object.keys(fields).map(
    (key) => key.toLowerCase()
  );
};

const hasChanged = (
  change,
  words = []
) => {
  const keys = changedKeys(change);

  return words.some((word) =>
    keys.some((key) =>
      key.includes(
        String(word).toLowerCase()
      )
    )
  );
};

const processUserEvent = async (
  change,
  doc
) => {
  const { email, name } =
    await resolveUser(doc);

  if (!email) return;

  if (change.operationType === 'insert') {
    await sendWelcomeEmail({
      email,
      name,
    });

    console.log(
      `[EMAIL AUTO] Welcome email processed for ${email}`
    );

    return;
  }

  if (
    ['update', 'replace'].includes(
      change.operationType
    )
  ) {
    const securityChanged =
      change.operationType === 'replace' ||
      hasChanged(change, [
        'password',
        'email',
        'phone',
        'transactionpin',
        'pin',
        'twofactor',
        '2fa',
      ]);

    if (!securityChanged) return;

    let action =
      'Security information was updated on your ServicePay account';

    if (
      hasChanged(change, ['password'])
    ) {
      action = 'Password changed';
    } else if (
      hasChanged(change, ['email'])
    ) {
      action = 'Email address changed';
    } else if (
      hasChanged(change, ['phone'])
    ) {
      action = 'Phone number changed';
    } else if (
      hasChanged(change, [
        'transactionpin',
        'pin',
      ])
    ) {
      action =
        'Transaction PIN updated';
    }

    await sendSecurityEmail({
      email,
      name,
      action,
      date: new Date().toLocaleString(
        'en-NG'
      ),
    });

    console.log(
      `[EMAIL AUTO] Security email processed for ${email}`
    );
  }
};

const processTransactionEvent = async (
  change,
  doc
) => {
  if (
    !['insert', 'update', 'replace'].includes(
      change.operationType
    )
  ) {
    return;
  }

  if (
    change.operationType === 'update' &&
    !hasChanged(change, [
      'status',
      'amount',
    ])
  ) {
    return;
  }

  const { email, name } =
    await resolveUser(doc);

  if (!email) return;

  const type = firstValue(
    doc.type,
    doc.transactionType,
    doc.serviceType,
    doc.service,
    doc.category,
    doc.product,
    'Transaction'
  );

  const amount = Number(
    firstValue(
      doc.amount,
      doc.totalAmount,
      doc.debitAmount,
      doc.value,
      0
    )
  );

  const reference = firstValue(
    doc.reference,
    doc.transactionReference,
    doc.ref,
    doc.paymentReference,
    doc.requestReference,
    doc._id
  );

  const status = normalizeStatus(
    firstValue(
      doc.status,
      doc.transactionStatus,
      'PENDING'
    )
  );

  await sendTransactionEmail({
    email,
    name,
    type,
    amount,
    reference: text(reference),
    status,
    date: firstValue(
      doc.updatedAt,
      doc.createdAt,
      new Date()
    ),
  });

  console.log(
    `[EMAIL AUTO] Transaction email processed for ${email} (${status})`
  );
};

const processKycEvent = async (
  change,
  doc
) => {
  if (
    !['insert', 'update', 'replace'].includes(
      change.operationType
    )
  ) {
    return;
  }

  if (
    change.operationType === 'update' &&
    !hasChanged(change, [
      'status',
      'tier',
      'level',
      'reason',
      'rejection',
    ])
  ) {
    return;
  }

  const { email, name } =
    await resolveUser(doc);

  if (!email) return;

  await sendKycEmail({
    email,
    name,
    tier: firstValue(
      doc.tier,
      doc.kycTier,
      doc.level,
      doc.kycLevel,
      'KYC'
    ),
    status: normalizeStatus(
      firstValue(
        doc.status,
        doc.verificationStatus,
        'PENDING'
      )
    ),
    reason: firstValue(
      doc.reason,
      doc.rejectionReason,
      doc.adminNote,
      ''
    ),
  });

  console.log(
    `[EMAIL AUTO] KYC/KYB email processed for ${email}`
  );
};

const processWithdrawalEvent = async (
  change,
  doc
) => {
  if (
    !['insert', 'update', 'replace'].includes(
      change.operationType
    )
  ) {
    return;
  }

  if (
    change.operationType === 'update' &&
    !hasChanged(change, [
      'status',
      'reason',
      'rejection',
    ])
  ) {
    return;
  }

  const { email, name } =
    await resolveUser(doc);

  if (!email) return;

  await sendWithdrawalEmail({
    email,
    name,
    amount: Number(
      firstValue(
        doc.amount,
        doc.withdrawalAmount,
        0
      )
    ),
    reference: text(
      firstValue(
        doc.reference,
        doc.ref,
        doc.requestReference,
        doc._id
      )
    ),
    status: normalizeStatus(
      firstValue(
        doc.status,
        'PENDING'
      )
    ),
    reason: firstValue(
      doc.reason,
      doc.rejectionReason,
      doc.adminNote,
      ''
    ),
  });

  console.log(
    `[EMAIL AUTO] Withdrawal email processed for ${email}`
  );
};

const processEmpowermentEvent = async (
  change,
  doc
) => {
  if (
    !['insert', 'update', 'replace'].includes(
      change.operationType
    )
  ) {
    return;
  }

  if (
    change.operationType === 'update' &&
    !hasChanged(change, [
      'status',
      'approval',
      'amount',
      'disbursement',
    ])
  ) {
    return;
  }

  const { email, name } =
    await resolveUser(doc);

  if (!email) return;

  await sendEmpowermentEmail({
    email,
    name,
    programName: firstValue(
      doc.programName,
      doc.programTitle,
      doc.title,
      doc.schemeName,
      'ServicePay Empowerment'
    ),
    amount: firstValue(
      doc.amount,
      doc.approvedAmount,
      doc.disbursementAmount
    ),
    reference: text(
      firstValue(
        doc.reference,
        doc.applicationReference,
        doc.ref,
        doc._id
      )
    ),
    status: normalizeStatus(
      firstValue(
        doc.status,
        doc.applicationStatus,
        'PENDING'
      )
    ),
    message: firstValue(
      doc.message,
      doc.adminMessage,
      doc.note
    ),
  });

  console.log(
    `[EMAIL AUTO] Empowerment email processed for ${email}`
  );
};

const handleChange = async (change) => {
  try {
    const collection =
      text(
        change?.ns?.coll
      ).toLowerCase();

    const doc =
      change.fullDocument || {};

    if (!collection) return;

    if (
      collection === 'users' ||
      collection.endsWith('users')
    ) {
      return await processUserEvent(
        change,
        doc
      );
    }

    if (
      collection.includes('kyc') ||
      collection.includes('kyb') ||
      collection.includes(
        'verificationrequest'
      )
    ) {
      return await processKycEvent(
        change,
        doc
      );
    }

    if (
      collection.includes('withdraw')
    ) {
      return await processWithdrawalEvent(
        change,
        doc
      );
    }

    if (
      collection.includes(
        'empowerment'
      ) ||
      collection.includes(
        'beneficiar'
      )
    ) {
      return await processEmpowermentEvent(
        change,
        doc
      );
    }

    if (
      collection.includes(
        'transaction'
      ) ||
      collection.includes('transfer') ||
      collection.includes('payment') ||
      collection.includes('airtime') ||
      collection.includes('data') ||
      collection.includes(
        'electric'
      ) ||
      collection.includes('cable') ||
      collection.includes('funding')
    ) {
      return await processTransactionEvent(
        change,
        doc
      );
    }
  } catch (error) {
    console.error(
      '[EMAIL AUTO] Change processing failed:',
      error
    );
  }
};

const startEmailAutomation = async () => {
  if (
    watcher ||
    starting ||
    !mongoose.connection.db
  ) {
    return;
  }

  starting = true;

  try {
    watcher =
      mongoose.connection.watch(
        [],
        {
          fullDocument:
            'updateLookup',
        }
      );

    watcher.on(
      'change',
      (change) => {
        handleChange(change).catch(
          (error) =>
            console.error(
              '[EMAIL AUTO] Handler error:',
              error
            )
        );
      }
    );

    watcher.on('error', (error) => {
      console.error(
        '[EMAIL AUTO] MongoDB watcher error:',
        error.message
      );

      try {
        watcher?.close();
      } catch (_) {}

      watcher = null;
    });

    watcher.on('close', () => {
      watcher = null;
    });

    console.log(
      '✅ ServicePay automatic email notifications active'
    );
  } catch (error) {
    console.error(
      '[EMAIL AUTO] Could not start watcher:',
      error.message
    );

    watcher = null;
  } finally {
    starting = false;
  }
};

mongoose.connection.on(
  'connected',
  () => {
    setTimeout(
      startEmailAutomation,
      1000
    );
  }
);

mongoose.connection.on(
  'reconnected',
  () => {
    setTimeout(
      startEmailAutomation,
      1000
    );
  }
);

if (
  mongoose.connection.readyState === 1
) {
  setTimeout(
    startEmailAutomation,
    1000
  );
}

module.exports = {
  startEmailAutomation,
};
