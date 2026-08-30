const mongoose = require('mongoose');

const {
  sendWelcomeEmail,
  sendKycEmail,
  sendSecurityEmail,
} = require('./email.service');
const {
  retryPendingTransactionEmails,
  sendTransactionNotification,
} = require('./transactionEmailNotification.service');

let watcher = null;
let starting = false;
let restartTimer = null;
let retryTimer = null;
let changeQueue = Promise.resolve();
let lastSourceEventAt = null;
let reconciliationTimer = null;
let reconciliationRunning = false;

const AUTOMATION_STATE_ID =
  'transaction-email-automation-v2';
const INTERNAL_COLLECTIONS = [
  'emailautomationstates',
  'transactionemaildeliveries',
];
const WITHDRAWAL_COLLECTIONS =
  new Set([
    'withdrawalrequests',
    'riderwithdrawals',
    'solarofficerwithdrawals',
    'businesswalletwithdrawals',
  ]);
const EMPOWERMENT_COLLECTIONS =
  new Set([
    'empowermentfundings',
    'empowermentpayouts',
    'empowermentdisbursements',
  ]);
const TRANSACTION_COLLECTIONS =
  new Set([
    'transactions',
    'banktransfers',
    'manualfundings',
    'solarpayments',
    'businesswallettransactions',
    'airtimetocashes',
    'amanafundingrecords',
    'amanaorders',
    'marketplaceorders',
    'partnertransactions',
    'groupwalletledgers',
    'scheduledpayments',
    'exampins',
    'deliveries',
    'deliveryorders',
  ]);
const RECONCILIATION_COLLECTIONS =
  Array.from(
    new Set([
      ...WITHDRAWAL_COLLECTIONS,
      ...EMPOWERMENT_COLLECTIONS,
      ...TRANSACTION_COLLECTIONS,
      'ledgerentries',
      'transfers',
      'featurepayments',
      'paymentlinks',
    ])
  );

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
    doc.buyerEmail,
    doc.borrowerEmail,
    doc.memberEmail,
    doc.payerEmail,
    doc.senderEmail,
    doc.actorEmail,
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
    doc.buyerName,
    doc.borrowerName,
    doc.memberName,
    doc.payerName,
    doc.senderName,
    doc.actorName,
    doc.recipientName,
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
    doc.paidBy,
    doc.payerId,
    doc.payer,
    doc.senderId,
    doc.sender,
    doc.actorId,
    doc.actor,
    doc.requestedBy,
    doc.buyerId,
    doc.buyer,
    doc.borrowerId,
    doc.borrower,
    doc.memberId,
    doc.member,
    doc.recipientId,
    doc.recipient,
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
  const partnerRef = asObjectId(
    firstValue(
      doc.partnerId,
      doc.partner
    )
  );

  if (!ref && !partnerRef) {
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

    const user = ref
      ? await db
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
          )
      : null;
    const partner =
      !user && partnerRef
        ? await db
            .collection('partners')
            .findOne(
              { _id: partnerRef },
              {
                projection: {
                  email: 1,
                  contactName: 1,
                  businessName: 1,
                },
              }
            )
        : null;

    return {
      email:
        user?.email ||
        partner?.email ||
        null,
      name:
        user?.fullName ||
        user?.name ||
        partner?.contactName ||
        partner?.businessName ||
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

const getChangeSourceTime = (
  change = {}
) => {
  const wallTime = new Date(
    change.wallTime || ''
  );

  if (!Number.isNaN(wallTime.getTime())) {
    return wallTime;
  }

  const clusterTime =
    change.clusterTime;
  const seconds =
    typeof clusterTime?.getHighBits ===
    'function'
      ? clusterTime.getHighBits()
      : Number(
          clusterTime?.t ??
            clusterTime?.high ??
            NaN
        );

  if (
    Number.isFinite(seconds) &&
    seconds > 0
  ) {
    return new Date(seconds * 1000);
  }

  return null;
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
  doc,
  collection = 'transactions'
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
      'payment',
      'funds',
      'refund',
      'orderstatus',
    ])
  ) {
    return;
  }

  const { email, name } =
    await resolveUser(doc);

  const type = firstValue(
    doc.type,
    doc.transactionType,
    doc.serviceType,
    doc.service,
    doc.category,
    doc.product,
    collection,
    'Transaction'
  );

  const amount = Number(
    firstValue(
      doc.amount,
      doc.totalAmount,
      doc.debitAmount,
      doc.totalDebit,
      doc.airtimeAmount,
      doc.cashAmount,
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
    doc.orderReference,
    doc.providerReference,
    doc.trackingNumber,
    doc._id
  );

  const status = normalizeStatus(
    firstValue(
      doc.status,
      doc.transactionStatus,
      doc.paymentStatus,
      doc.fundsStatus,
      doc.orderStatus,
      doc.providerStatus,
      'PENDING'
    )
  );

  const providerResponse =
    doc.providerResponse &&
    typeof doc.providerResponse === 'object'
      ? doc.providerResponse
      : {};

  const creditTypes = new Set([
    'WALLET_FUNDING',
    'MANUAL_FUNDING',
    'EMPOWERMENT_DISBURSEMENT',
    'REFERRAL_BONUS',
    'REFUND',
    'REVERSAL',
  ]);

  const normalizedType =
    text(type).trim().toUpperCase();

  const direction = [
    'REFUNDED',
    'REVERSED',
  ].includes(normalizeStatus(status))
    ? 'CREDIT'
    : firstValue(
        doc.direction,
        doc.transactionDirection,
        providerResponse.transactionDirection,
        ['DEBIT', 'CREDIT'].includes(
          normalizedType
        )
          ? normalizedType
          : null,
        collection === 'airtimetocashes'
          ? 'CREDIT'
          : null,
        creditTypes.has(normalizedType)
          ? 'CREDIT'
          : 'DEBIT'
      );

  const userReference = asObjectId(
    getUserReference(doc)
  );

  await sendTransactionNotification({
    email,
    userId: userReference,
    name,
    type,
    direction,
    amount,
    reference: text(reference),
    status,
    date: firstValue(
      doc.updatedAt,
      doc.createdAt,
      new Date()
    ),
    balance: firstValue(
      doc.closingBalance,
      doc.balanceAfter,
      doc.walletBalance,
      providerResponse.balanceAfter,
      providerResponse.walletBalance
    ),
    counterparty: firstValue(
      doc.counterparty,
      doc.recipientName,
      doc.senderName,
      providerResponse.narration
    ),
    provider: firstValue(
      doc.provider,
      doc.network,
      doc.serviceProvider,
      providerResponse.provider,
      providerResponse.network
    ),
    serviceDetails: firstValue(
      doc.description,
      doc.narration,
      doc.phone,
      doc.meterNumber,
      doc.smartCardNumber,
      providerResponse.narration,
      providerResponse.phone,
      providerResponse.meterNumber,
      providerResponse.smartCardNumber,
      providerResponse.token,
      collection
    ),
  });

  console.log(
    `[EMAIL AUTO] Transaction email processed for ${email} (${status})`
  );
};

const processFeaturePaymentEvent = async (
  change,
  doc,
  {
    resolve = resolveUser,
    notify = sendTransactionNotification,
  } = {}
) => {
  if (
    !['insert', 'update', 'replace'].includes(
      change.operationType
    ) ||
    (change.operationType === 'update' &&
      !hasChanged(change, [
        'status',
        'amount',
      ]))
  ) {
    return;
  }

  const [payer, beneficiary] =
    await Promise.all([
      resolve({ userId: doc.payer }),
      doc.beneficiary
        ? resolve({
            userId: doc.beneficiary,
          })
        : Promise.resolve({
            email: null,
            name: '',
          }),
    ]);
  const status = normalizeStatus(
    firstValue(doc.status, 'PENDING')
  );
  const reversed = [
    'REVERSED',
    'REFUNDED',
  ].includes(status);
  const reference = text(
    firstValue(doc.reference, doc._id)
  );
  const common = {
    type: firstValue(
      doc.featureType,
      'FEATURE PAYMENT'
    ),
    amount: doc.amount,
    reference,
    status,
    date: firstValue(
      doc.completedAt,
      doc.updatedAt,
      doc.createdAt,
      new Date()
    ),
    serviceDetails: doc.description,
  };

  await Promise.all([
    notify({
          ...common,
          email: payer.email,
          userId: doc.payer,
          name: payer.name,
          direction: reversed
            ? 'CREDIT'
            : 'DEBIT',
          counterparty:
            beneficiary.name,
        }),
    !reversed
      ? notify({
          ...common,
          email: beneficiary.email,
          userId: doc.beneficiary,
          name: beneficiary.name,
          direction: 'CREDIT',
          counterparty: payer.name,
        })
      : Promise.resolve(),
  ]);
};

const processPaymentLinkEvent = async (
  change,
  doc,
  {
    resolve = resolveUser,
    notify = sendTransactionNotification,
  } = {}
) => {
  if (
    !['insert', 'update', 'replace'].includes(
      change.operationType
    )
  ) {
    return;
  }

  const status = normalizeStatus(
    firstValue(doc.status, 'ACTIVE')
  );

  if (
    !['PAID', 'SUCCESSFUL'].includes(
      status
    )
  ) {
    return;
  }

  const [payer, owner] =
    await Promise.all([
      resolve({ userId: doc.paidBy }),
      resolve({ userId: doc.owner }),
    ]);
  const reference = text(
    firstValue(
      doc.reference,
      doc.code,
      doc._id
    )
  );
  const common = {
    type: 'PAY BY LINK',
    amount: doc.amount,
    reference,
    status,
    date: firstValue(
      doc.paidAt,
      doc.updatedAt,
      new Date()
    ),
    serviceDetails: firstValue(
      doc.title,
      doc.description
    ),
  };

  await Promise.all([
    notify({
          ...common,
          email: payer.email,
          userId: doc.paidBy,
          name: payer.name,
          direction: 'DEBIT',
          counterparty: owner.name,
        }),
    notify({
          ...common,
          email: owner.email,
          userId: doc.owner,
          name: owner.name,
          direction: 'CREDIT',
          counterparty: payer.name,
        }),
  ]);
};

const processLedgerEvent = async (
  change,
  doc,
  {
    resolve = resolveUser,
    notify = sendTransactionNotification,
  } = {}
) => {
  if (change.operationType !== 'insert') {
    return;
  }

  const { email, name } =
    await resolve({
      userId: doc.user,
    });

  let counterparty = '';

  if (doc.relatedUser) {
    const related = await resolve({
      userId: doc.relatedUser,
    });
    counterparty = related.name;
  }

  const service = text(
    firstValue(
      doc.service,
      'WALLET TRANSACTION'
    )
  ).toUpperCase();
  const isRefund =
    normalizeStatus(doc.status) ===
      'REVERSED' ||
    service.includes('REFUND') ||
    service.includes('REVERSAL');

  await notify({
    email,
    userId: doc.user,
    name,
    type: service,
    direction: doc.direction,
    amount: doc.amount,
    reference: text(
      firstValue(doc.reference, doc._id)
    ),
    status: isRefund
      ? 'REFUNDED'
      : 'SUCCESSFUL',
    date: firstValue(
      doc.createdAt,
      new Date()
    ),
    balance: doc.closingBalance,
    counterparty,
    serviceDetails: doc.narration,
    message:
      doc.direction === 'CREDIT'
        ? 'Your ServicePay wallet has been credited successfully.'
        : 'A debit was completed successfully on your ServicePay wallet.',
  });
};

const processTransferEvent = async (
  change,
  doc,
  {
    resolve = resolveUser,
    notify = sendTransactionNotification,
  } = {}
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
    !hasChanged(change, ['status'])
  ) {
    return;
  }

  const [sender, receiver] =
    await Promise.all([
      resolve({ userId: doc.sender }),
      resolve({ userId: doc.receiver }),
    ]);
  const status = normalizeStatus(
    firstValue(doc.status, 'SUCCESSFUL')
  );
  const reference = text(
    firstValue(doc.reference, doc._id)
  );
  const date = firstValue(
    doc.updatedAt,
    doc.createdAt,
    new Date()
  );

  await Promise.all([
    notify({
          email: sender.email,
          userId: doc.sender,
          name: sender.name,
          type: 'SERVICEPAY TRANSFER',
          direction: 'DEBIT',
          amount: doc.amount,
          reference,
          status,
          date,
          balance:
            doc.senderBalanceAfter,
          counterparty: receiver.name,
          message:
            'Your ServicePay transfer was sent to the recipient.',
        }),
    notify({
          email: receiver.email,
          userId: doc.receiver,
          name: receiver.name,
          type: 'SERVICEPAY TRANSFER',
          direction: 'CREDIT',
          amount: doc.amount,
          reference,
          status,
          date,
          balance:
            doc.receiverBalanceAfter,
          counterparty: sender.name,
          message:
            'You received a ServicePay wallet transfer.',
        }),
  ]);
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

  const userReference = asObjectId(
    getUserReference(doc)
  );

  await sendTransactionNotification({
    email,
    userId: userReference,
    name,
    type: 'WITHDRAWAL',
    direction: 'DEBIT',
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
    message: firstValue(
      doc.reason,
      doc.rejectionReason,
      doc.adminNote,
      'There has been an update on your withdrawal request.'
    ),
    date: firstValue(
      doc.updatedAt,
      doc.createdAt,
      new Date()
    ),
    balance: firstValue(
      doc.balanceAfter,
      doc.walletBalance
    ),
    provider: firstValue(
      doc.provider,
      doc.bankName
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

  const userReference = asObjectId(
    getUserReference(doc)
  );
  const eventType = text(
    firstValue(
      doc.type,
      doc.transactionType,
      'EMPOWERMENT DISBURSEMENT'
    )
  ).toUpperCase();

  await sendTransactionNotification({
    email,
    userId: userReference,
    name,
    type: eventType,
    direction: eventType.includes(
      'FUNDING'
    )
      ? 'DEBIT'
      : 'CREDIT',
    serviceDetails: firstValue(
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
    date: firstValue(
      doc.updatedAt,
      doc.createdAt,
      new Date()
    ),
    balance: firstValue(
      doc.balanceAfter,
      doc.walletBalance
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
      WITHDRAWAL_COLLECTIONS.has(
        collection
      )
    ) {
      return await processWithdrawalEvent(
        change,
        doc
      );
    }

    if (
      EMPOWERMENT_COLLECTIONS.has(
        collection
      )
    ) {
      return await processEmpowermentEvent(
        change,
        doc
      );
    }

    if (collection === 'ledgerentries') {
      return await processLedgerEvent(
        change,
        doc
      );
    }

    if (collection === 'transfers') {
      return await processTransferEvent(
        change,
        doc
      );
    }

    if (collection === 'featurepayments') {
      return await processFeaturePaymentEvent(
        change,
        doc
      );
    }

    if (collection === 'paymentlinks') {
      return await processPaymentLinkEvent(
        change,
        doc
      );
    }

    if (
      TRANSACTION_COLLECTIONS.has(
        collection
      )
    ) {
      return await processTransactionEvent(
        change,
        doc,
        collection
      );
    }
  } catch (error) {
    console.error(
      '[EMAIL AUTO] Change processing failed:',
      error
    );
  }
};

const reconcileRecentTransactionEvents =
  async ({
    stateCollection,
    reconciliation,
  }) => {
    const db = mongoose.connection.db;
    const since = new Date(
      reconciliation?.since
    );
    const highWaterMark = new Date(
      reconciliation?.highWaterMark
    );

    if (
      !db ||
      !stateCollection ||
      Number.isNaN(since.getTime()) ||
      Number.isNaN(
        highWaterMark.getTime()
      )
    ) {
      throw new Error(
        'A valid reconciliation range is required.'
      );
    }

    let collectionIndex = Number(
      reconciliation.collectionIndex || 0
    );
    let lastEventAt =
      reconciliation.lastEventAt
        ? new Date(
            reconciliation.lastEventAt
          )
        : null;
    let lastId =
      reconciliation.lastId || null;
    let processed = Number(
      reconciliation.processed || 0
    );
    const batchSize = 250;

    while (
      collectionIndex <
      RECONCILIATION_COLLECTIONS.length
    ) {
      const collection =
        RECONCILIATION_COLLECTIONS[
          collectionIndex
        ];
      const cursorMatch =
        lastEventAt && lastId
          ? {
              $or: [
                {
                  __emailEventAt: {
                    $gt: lastEventAt,
                  },
                },
                {
                  __emailEventAt:
                    lastEventAt,
                  _id: { $gt: lastId },
                },
              ],
            }
          : {};
      const documents = await db
        .collection(collection)
        .aggregate([
          {
            $addFields: {
              __emailEventAt: {
                $ifNull: [
                  '$updatedAt',
                  '$createdAt',
                ],
              },
            },
          },
          {
            $match: {
              __emailEventAt: {
                $gte: since,
                $lte: highWaterMark,
              },
              ...cursorMatch,
            },
          },
          {
            $sort: {
              __emailEventAt: 1,
              _id: 1,
            },
          },
          { $limit: batchSize },
        ])
        .toArray();

      for (const document of documents) {
        const eventAt =
          document.__emailEventAt;
        delete document.__emailEventAt;

        await handleChange({
          operationType: 'insert',
          ns: { coll: collection },
          fullDocument: document,
        });

        lastEventAt = eventAt;
        lastId = document._id;
        processed += 1;
      }

      if (documents.length < batchSize) {
        collectionIndex += 1;
        lastEventAt = null;
        lastId = null;
      }

      await stateCollection.updateOne(
        { _id: AUTOMATION_STATE_ID },
        {
          $set: {
            'reconciliation.collectionIndex':
              collectionIndex,
            'reconciliation.lastEventAt':
              lastEventAt,
            'reconciliation.lastId':
              lastId,
            'reconciliation.processed':
              processed,
            'reconciliation.updatedAt':
              new Date(),
          },
        }
      );
    }

    await stateCollection.updateOne(
      { _id: AUTOMATION_STATE_ID },
      {
        $set: {
          'reconciliation.status':
            'COMPLETED',
          'reconciliation.completedAt':
            new Date(),
          'reconciliation.processed':
            processed,
        },
        $unset: {
          'reconciliation.lastEventAt': '',
          'reconciliation.lastId': '',
        },
      }
    );

    console.log(
      `[EMAIL AUTO] Reconciled ${processed} financial events through ${highWaterMark.toISOString()}`
    );

    return { processed };
  };

const scheduleReconciliation = (
  stateCollection,
  delay = 0
) => {
  clearTimeout(reconciliationTimer);
  reconciliationTimer = setTimeout(
    async () => {
      if (reconciliationRunning) {
        scheduleReconciliation(
          stateCollection,
          30000
        );
        return;
      }

      reconciliationRunning = true;

      try {
        const current =
          await stateCollection.findOne({
            _id: AUTOMATION_STATE_ID,
          });

        if (
          current?.reconciliation
            ?.status !== 'PENDING'
        ) {
          return;
        }

        await reconcileRecentTransactionEvents(
          {
            stateCollection,
            reconciliation:
              current.reconciliation,
          }
        );
      } catch (error) {
        console.error(
          '[EMAIL AUTO] Recovery reconciliation failed:',
          error.message
        );
        scheduleReconciliation(
          stateCollection,
          30000
        );
      } finally {
        reconciliationRunning = false;
      }
    },
    delay
  );
  reconciliationTimer.unref?.();
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
    const stateCollection =
      mongoose.connection.db.collection(
        'emailautomationstates'
      );
    const state =
      await stateCollection.findOne({
        _id: AUTOMATION_STATE_ID,
      });
    lastSourceEventAt =
      state?.lastSourceEventAt ||
      state?.lastProcessedAt ||
      lastSourceEventAt;
    const watchOptions = {
      fullDocument: 'updateLookup',
    };

    if (state?.resumeToken) {
      watchOptions.resumeAfter =
        state.resumeToken;
    }

    watcher =
      mongoose.connection.watch(
        [
          {
            $match: {
              'ns.coll': {
                $nin: INTERNAL_COLLECTIONS,
              },
            },
          },
        ],
        watchOptions
      );

    watcher.on(
      'change',
      (change) => {
        changeQueue = changeQueue
          .then(async () => {
            await handleChange(change);

            const checkpointAt =
              new Date();
            const sourceEventAt =
              getChangeSourceTime(
                change
              ) || checkpointAt;
            await stateCollection.updateOne(
              {
                _id: AUTOMATION_STATE_ID,
              },
              {
                $set: {
                  resumeToken: change._id,
                  lastProcessedAt:
                    checkpointAt,
                  lastSourceEventAt:
                    sourceEventAt,
                  updatedAt: checkpointAt,
                },
                $setOnInsert: {
                  createdAt: new Date(),
                },
              },
              { upsert: true }
            );
            lastSourceEventAt =
              sourceEventAt;
          })
          .catch((error) =>
            console.error(
              '[EMAIL AUTO] Handler error:',
              error
            )
          );
      }
    );

    watcher.on('error', async (error) => {
      console.error(
        '[EMAIL AUTO] MongoDB watcher error:',
        error.message
      );

      if (
        error?.code === 286 ||
        error?.codeName ===
          'ChangeStreamHistoryLost'
      ) {
        const checkpoint =
          lastSourceEventAt
            ? new Date(
                lastSourceEventAt
              )
            : new Date(
                Date.now() -
                  15 * 60 * 1000
              );
        try {
          const current =
            await stateCollection.findOne({
              _id: AUTOMATION_STATE_ID,
            });
          const proposedSince =
            new Date(
              checkpoint.getTime() -
                5 * 60 * 1000
            );
          const existingSince =
            current?.reconciliation
              ?.status === 'PENDING'
              ? new Date(
                  current.reconciliation
                    .since
                )
              : null;
          const since =
            existingSince &&
            !Number.isNaN(
              existingSince.getTime()
            ) &&
            existingSince <
              proposedSince
              ? existingSince
              : proposedSince;

          await stateCollection.updateOne(
            {
              _id: AUTOMATION_STATE_ID,
            },
            {
              $set: {
                reconciliation: {
                  status: 'PENDING',
                  since,
                  highWaterMark:
                    new Date(),
                  collectionIndex: 0,
                  lastEventAt: null,
                  lastId: null,
                  processed: 0,
                  captureHighWaterOnStart:
                    true,
                  createdAt: new Date(),
                },
                updatedAt: new Date(),
              },
              $unset: {
                resumeToken: '',
              },
              $setOnInsert: {
                createdAt: new Date(),
              },
            },
            { upsert: true }
          );
        } catch (stateError) {
          console.error(
            '[EMAIL AUTO] Could not persist recovery state:',
            stateError.message
          );
        }
      }

      try {
        await watcher?.close();
      } catch (_) {}

      watcher = null;

      clearTimeout(restartTimer);
      restartTimer = setTimeout(
        startEmailAutomation,
        5000
      );
      restartTimer.unref?.();
    });

    watcher.on('close', () => {
      watcher = null;
    });

    if (
      state?.reconciliation?.status ===
      'PENDING'
    ) {
      if (
        state.reconciliation
          .captureHighWaterOnStart
      ) {
        const highWaterMark =
          new Date();

        await stateCollection.updateOne(
          {
            _id: AUTOMATION_STATE_ID,
          },
          {
            $set: {
              'reconciliation.highWaterMark':
                highWaterMark,
              'reconciliation.captureHighWaterOnStart':
                false,
              'reconciliation.updatedAt':
                highWaterMark,
            },
          }
        );
      }

      scheduleReconciliation(
        stateCollection
      );
    }

    retryPendingTransactionEmails().catch(
      (error) =>
        console.error(
          '[EMAIL AUTO] Initial retry failed:',
          error.message
        )
    );

    if (!retryTimer) {
      retryTimer = setInterval(
        retryPendingTransactionEmails,
        60 * 1000
      );
      retryTimer.unref?.();
    }

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
  getChangeSourceTime,
  handleChange,
  processFeaturePaymentEvent,
  processLedgerEvent,
  processPaymentLinkEvent,
  processTransactionEvent,
  processTransferEvent,
  processWithdrawalEvent,
  reconcileRecentTransactionEvents,
  startEmailAutomation,
};
