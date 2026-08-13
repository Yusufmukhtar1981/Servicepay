const EmpowermentOrganization = require(
  "../models/empowermentOrganization.model"
);

const EmpowermentProgram = require(
  "../models/empowermentProgram.model"
);

const EmpowermentBeneficiary = require(
  "../models/empowermentBeneficiary.model"
);

const KycProfile = require("../models/kycProfile.model");
const User = require("../models/user.model");

const EmpowermentDisbursement = require(
  "../models/empowermentDisbursement.model"
);


const createOrganization = async (req, res) => {
  try {
    const {
      name,
      organizationType,
      contactName,
      phone,
      email,
      state,
      lga,
    } = req.body || {};

    if (!name || !organizationType) {
      return res.status(400).json({
        success: false,
        message:
          "Organization name and organization type are required.",
      });
    }

    const organization =
      await EmpowermentOrganization.create({
        name,
        organizationType,
        contactName: contactName || "",
        phone: phone || "",
        email: email || "",
        state: state || "",
        lga: lga || "",
        createdBy: req.user?._id || null,
      });

    return res.status(201).json({
      success: true,
      message: "Empowerment organization created.",
      organization,
    });
  } catch (error) {
    console.error(
      "CREATE EMPOWERMENT ORGANIZATION ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Unable to create organization.",
    });
  }
};


const listOrganizations = async (req, res) => {
  try {
    const organizations = await EmpowermentOrganization.find({})
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: organizations.length,
      organizations,
    });
  } catch (error) {
    console.error(
      "LIST EMPOWERMENT ORGANIZATIONS ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Unable to load empowerment organizations.",
    });
  }
};

const createProgram = async (req, res) => {
  try {
    const {
      organizationId,
      name,
      description,
      programType,
      targetGroup,
      state,
      lga,
      ward,
      amountPerBeneficiary,
      targetBeneficiaries,
      startDate,
      endDate,
      publicApplicationEnabled,
      publicTransparencyEnabled,
    } = req.body || {};

    if (
      !organizationId ||
      !name ||
      !amountPerBeneficiary ||
      !targetBeneficiaries
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Organization, program name, amount and beneficiary target are required.",
      });
    }

    const organization =
      await EmpowermentOrganization.findById(
        organizationId
      );

    if (!organization) {
      return res.status(404).json({
        success: false,
        message: "Organization not found.",
      });
    }

    const amount =
      Number(amountPerBeneficiary);

    const target =
      Number(targetBeneficiaries);

    const program =
      await EmpowermentProgram.create({
        organization: organization._id,
        name,
        description: description || "",
        programType:
          programType || "CASH_GRANT",
        targetGroup:
          targetGroup || "GENERAL",
        state: state || "",
        lga: lga || "",
        ward: ward || "",
        amountPerBeneficiary: amount,
        targetBeneficiaries: target,
        totalBudget: amount * target,
        startDate: startDate || null,
        endDate: endDate || null,
        publicApplicationEnabled:
          publicApplicationEnabled === true,
        publicTransparencyEnabled:
          publicTransparencyEnabled === true,
        createdBy: req.user?._id || null,
      });

    return res.status(201).json({
      success: true,
      message: "Empowerment program created.",
      program,
    });
  } catch (error) {
    console.error(
      "CREATE EMPOWERMENT PROGRAM ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Unable to create program.",
    });
  }
};

const addBeneficiary = async (req, res) => {
  try {
    const {
      programId,
      fullName,
      phone,
      email,
      state,
      lga,
      ward,
      userId,
    } = req.body || {};

    if (!programId || !fullName || !phone) {
      return res.status(400).json({
        success: false,
        message:
          "Program, full name and phone are required.",
      });
    }

    const program =
      await EmpowermentProgram.findById(
        programId
      );

    if (!program) {
      return res.status(404).json({
        success: false,
        message: "Program not found.",
      });
    }

    const beneficiary =
      await EmpowermentBeneficiary.create({
        program: program._id,
        user: userId || null,
        fullName,
        phone,
        email: email || "",
        state: state || "",
        lga: lga || "",
        ward: ward || "",
        amount:
          program.amountPerBeneficiary || 0,
      });

    return res.status(201).json({
      success: true,
      message: "Beneficiary added.",
      beneficiary,
    });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({
        success: false,
        message:
          "This beneficiary already exists in the program.",
      });
    }

    console.error(
      "ADD EMPOWERMENT BENEFICIARY ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Unable to add beneficiary.",
    });
  }
};

const listPrograms = async (req, res) => {
  try {
    const programs =
      await EmpowermentProgram.find()
        .populate("organization")
        .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: programs.length,
      programs,
    });
  } catch (error) {
    console.error(
      "LIST EMPOWERMENT PROGRAMS ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Unable to load programs.",
    });
  }
};

const listBeneficiaries = async (req, res) => {
  try {
    const { programId } = req.params;

    const beneficiaries =
      await EmpowermentBeneficiary.find({
        program: programId,
      }).sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: beneficiaries.length,
      beneficiaries,
    });
  } catch (error) {
    console.error(
      "LIST EMPOWERMENT BENEFICIARIES ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Unable to load beneficiaries.",
    });
  }
};


const updateOrganizationStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const status = String(req.body?.status || "").toUpperCase();

    const allowed = [
      "PENDING",
      "ACTIVE",
      "SUSPENDED",
      "REJECTED",
    ];

    if (!allowed.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid organization status.",
      });
    }

    const organization =
      await EmpowermentOrganization.findById(id);

    if (!organization) {
      return res.status(404).json({
        success: false,
        message: "Organization not found.",
      });
    }

    organization.status = status;
    await organization.save();

    return res.status(200).json({
      success: true,
      message: `Organization status updated to ${status}.`,
      organization,
    });
  } catch (error) {
    console.error(
      "UPDATE EMPOWERMENT ORGANIZATION STATUS ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Unable to update organization status.",
    });
  }
};

const updateProgramStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const status = String(req.body?.status || "").toUpperCase();

    const allowed = [
      "DRAFT",
      "OPEN",
      "UNDER_REVIEW",
      "APPROVED",
      "DISBURSING",
      "COMPLETED",
      "SUSPENDED",
      "CANCELLED",
    ];

    if (!allowed.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid program status.",
      });
    }

    const program =
      await EmpowermentProgram.findById(id);

    if (!program) {
      return res.status(404).json({
        success: false,
        message: "Program not found.",
      });
    }

    program.status = status;
    await program.save();

    return res.status(200).json({
      success: true,
      message: `Program status updated to ${status}.`,
      program,
    });
  } catch (error) {
    console.error(
      "UPDATE EMPOWERMENT PROGRAM STATUS ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Unable to update program status.",
    });
  }
};

const updateBeneficiaryStatus = async (req, res) => {
  try {
    const { id } = req.params;

    const status = String(
      req.body?.status || ""
    ).toUpperCase();

    const rejectionReason = String(
      req.body?.rejectionReason || ""
    ).trim();

    const allowed = [
      "SUBMITTED",
      "UNDER_REVIEW",
      "APPROVED",
      "REJECTED",
      "PAYMENT_PENDING",
      "PAID",
      "FAILED",
      "REVERSED",
    ];

    if (!allowed.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid beneficiary status.",
      });
    }

    if (
      status === "REJECTED" &&
      !rejectionReason
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Rejection reason is required.",
      });
    }

    const beneficiary =
      await EmpowermentBeneficiary.findById(id);

    if (!beneficiary) {
      return res.status(404).json({
        success: false,
        message: "Beneficiary not found.",
      });
    }

    beneficiary.applicationStatus = status;

    if (status === "REJECTED") {
      beneficiary.rejectionReason =
        rejectionReason;
    } else {
      beneficiary.rejectionReason = "";
    }

    await beneficiary.save();

    return res.status(200).json({
      success: true,
      message:
        `Beneficiary status updated to ${status}.`,
      beneficiary,
    });
  } catch (error) {
    console.error(
      "UPDATE EMPOWERMENT BENEFICIARY STATUS ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to update beneficiary status.",
    });
  }
};


const applyForProgram = async (req, res) => {
  try {
    const { programId } = req.params;

    const program =
      await EmpowermentProgram.findById(programId);

    if (!program) {
      return res.status(404).json({
        success: false,
        message: "Empowerment program not found.",
      });
    }

    if (!program.publicApplicationEnabled) {
      return res.status(403).json({
        success: false,
        message:
          "Public applications are not enabled for this program.",
      });
    }

    if (
      !["OPEN", "APPROVED"].includes(
        String(program.status || "").toUpperCase()
      )
    ) {
      return res.status(400).json({
        success: false,
        message:
          "This empowerment program is not currently accepting applications.",
      });
    }

    const userId = req.user?._id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized.",
      });
    }

    const existing =
      await EmpowermentBeneficiary.findOne({
        program: program._id,
        $or: [
          { user: userId },
          {
            phone:
              String(req.user?.phone || "").trim(),
          },
        ],
      });

    if (existing) {
      return res.status(409).json({
        success: false,
        message:
          "You have already applied for this empowerment program.",
        beneficiary: existing,
      });
    }

    const kyc =
      await KycProfile.findOne({
        user: userId,
      });

    const kycStatus =
      String(
        kyc?.status || "NOT_STARTED"
      ).toUpperCase();

    const beneficiary =
      await EmpowermentBeneficiary.create({
        program: program._id,
        user: userId,
        fullName:
          req.user?.fullName ||
          req.body?.fullName ||
          "",
        phone:
          req.user?.phone ||
          req.body?.phone ||
          "",
        email:
          req.user?.email ||
          req.body?.email ||
          "",
        state:
          req.body?.state ||
          kyc?.state ||
          "",
        lga:
          req.body?.lga ||
          kyc?.lga ||
          "",
        ward:
          req.body?.ward || "",
        kycStatus,
        applicationStatus: "SUBMITTED",
        amount:
          Number(
            program.amountPerBeneficiary || 0
          ),
        metadata: {
          source: "SELF_APPLICATION",
          kycLevel:
            kyc?.level || "TIER_1",
        },
      });

    return res.status(201).json({
      success: true,
      message:
        "Empowerment application submitted successfully.",
      beneficiary,
    });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({
        success: false,
        message:
          "You have already applied for this empowerment program.",
      });
    }

    console.error(
      "EMPOWERMENT SELF APPLICATION ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to submit empowerment application.",
    });
  }
};

const getMyApplications = async (req, res) => {
  try {
    const userId = req.user?._id;

    const applications =
      await EmpowermentBeneficiary.find({
        user: userId,
      })
        .populate({
          path: "program",
          populate: {
            path: "organization",
          },
        })
        .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: applications.length,
      applications,
    });
  } catch (error) {
    console.error(
      "GET MY EMPOWERMENT APPLICATIONS ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to load your empowerment applications.",
    });
  }
};

const listAvailablePrograms = async (req, res) => {
  try {
    const programs =
      await EmpowermentProgram.find({
        publicApplicationEnabled: true,
        status: {
          $in: ["OPEN", "APPROVED"],
        },
      })
        .populate("organization")
        .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: programs.length,
      programs,
    });
  } catch (error) {
    console.error(
      "LIST AVAILABLE EMPOWERMENT PROGRAMS ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to load available programs.",
    });
  }
};


const normalizeEmpowermentPhone = (value) => {
  let phone = String(value || "")
    .replace(/\s+/g, "")
    .replace(/[()-]/g, "")
    .trim();

  if (phone.startsWith("+234")) {
    phone = "0" + phone.slice(4);
  } else if (
    phone.startsWith("234") &&
    phone.length >= 13
  ) {
    phone = "0" + phone.slice(3);
  }

  return phone;
};

const bulkAddBeneficiaries = async (req, res) => {
  try {
    const { programId } = req.params;

    const rows = Array.isArray(req.body?.beneficiaries)
      ? req.body.beneficiaries
      : [];

    if (!rows.length) {
      return res.status(400).json({
        success: false,
        message:
          "Beneficiaries list is required.",
      });
    }

    if (rows.length > 500) {
      return res.status(400).json({
        success: false,
        message:
          "Maximum 500 beneficiaries per batch.",
      });
    }

    const program =
      await EmpowermentProgram.findById(
        programId
      );

    if (!program) {
      return res.status(404).json({
        success: false,
        message:
          "Empowerment program not found.",
      });
    }

    const result = {
      received: rows.length,
      added: 0,
      skipped: 0,
      invalid: 0,
      duplicates: 0,
      linkedUsers: 0,
      records: [],
    };

    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i] || {};

      const fullName =
        String(
          row.fullName ||
          row.name ||
          ""
        ).trim();

      const phone =
        normalizeEmpowermentPhone(
          row.phone
        );

      const email =
        String(row.email || "")
          .trim()
          .toLowerCase();

      if (!fullName || !phone) {
        result.invalid += 1;

        result.records.push({
          row: i + 1,
          status: "INVALID",
          message:
            "Full name and phone are required.",
        });

        continue;
      }

      const existing =
        await EmpowermentBeneficiary.findOne({
          program: program._id,
          phone,
        });

      if (existing) {
        result.skipped += 1;
        result.duplicates += 1;

        result.records.push({
          row: i + 1,
          phone,
          status: "DUPLICATE",
          message:
            "Beneficiary already exists in this program.",
        });

        continue;
      }

      let user = null;

      user = await User.findOne({
        $or: [
          { phone },
          ...(email ? [{ email }] : []),
        ],
      });

      let kyc = null;

      if (user?._id) {
        kyc = await KycProfile.findOne({
          user: user._id,
        });

        result.linkedUsers += 1;
      }

      const beneficiary =
        await EmpowermentBeneficiary.create({
          program: program._id,
          user: user?._id || null,

          fullName,
          phone,
          email,

          state:
            String(
              row.state ||
              kyc?.state ||
              ""
            ).trim(),

          lga:
            String(
              row.lga ||
              kyc?.lga ||
              ""
            ).trim(),

          ward:
            String(
              row.ward || ""
            ).trim(),

          kycStatus:
            String(
              kyc?.status ||
              "NOT_STARTED"
            ).toUpperCase(),

          applicationStatus:
            "SUBMITTED",

          amount:
            Number(
              program.amountPerBeneficiary ||
              0
            ),

          metadata: {
            source: "BULK_UPLOAD",
            rowNumber: i + 1,
            kycLevel:
              kyc?.level || "TIER_1",
          },
        });

      result.added += 1;

      result.records.push({
        row: i + 1,
        beneficiaryId:
          beneficiary._id,
        phone,
        status: "ADDED",
      });
    }

    return res.status(200).json({
      success: true,
      message:
        `${result.added} beneficiaries added successfully.`,
      result,
    });
  } catch (error) {
    console.error(
      "BULK EMPOWERMENT BENEFICIARY ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to process beneficiaries.",
    });
  }
};

const getProgramStatistics = async (req, res) => {
  try {
    const { programId } = req.params;

    const program =
      await EmpowermentProgram.findById(
        programId
      ).populate("organization");

    if (!program) {
      return res.status(404).json({
        success: false,
        message:
          "Empowerment program not found.",
      });
    }

    const aggregate =
      await EmpowermentBeneficiary.aggregate([
        {
          $match: {
            program: program._id,
          },
        },
        {
          $group: {
            _id: "$applicationStatus",
            count: { $sum: 1 },
            amount: {
              $sum: {
                $cond: [
                  {
                    $eq: [
                      "$applicationStatus",
                      "PAID",
                    ],
                  },
                  "$amount",
                  0,
                ],
              },
            },
          },
        },
      ]);

    const stats = {
      total: 0,
      submitted: 0,
      underReview: 0,
      approved: 0,
      rejected: 0,
      paymentPending: 0,
      paid: 0,
      failed: 0,
      reversed: 0,
      totalDisbursedAmount: 0,
    };

    for (const item of aggregate) {
      const count =
        Number(item.count || 0);

      stats.total += count;

      switch (item._id) {
        case "SUBMITTED":
          stats.submitted = count;
          break;

        case "UNDER_REVIEW":
          stats.underReview = count;
          break;

        case "APPROVED":
          stats.approved = count;
          break;

        case "REJECTED":
          stats.rejected = count;
          break;

        case "PAYMENT_PENDING":
          stats.paymentPending = count;
          break;

        case "PAID":
          stats.paid = count;
          stats.totalDisbursedAmount =
            Number(item.amount || 0);
          break;

        case "FAILED":
          stats.failed = count;
          break;

        case "REVERSED":
          stats.reversed = count;
          break;
      }
    }

    const approvedValue =
      stats.approved *
      Number(
        program.amountPerBeneficiary || 0
      );

    const remainingBudget =
      Math.max(
        0,
        Number(program.totalBudget || 0) -
        Number(
          stats.totalDisbursedAmount || 0
        )
      );

    return res.status(200).json({
      success: true,
      program,
      statistics: {
        ...stats,
        approvedValue,
        remainingBudget,
        targetBeneficiaries:
          Number(
            program.targetBeneficiaries || 0
          ),
        amountPerBeneficiary:
          Number(
            program.amountPerBeneficiary || 0
          ),
        totalBudget:
          Number(
            program.totalBudget || 0
          ),
      },
    });
  } catch (error) {
    console.error(
      "EMPOWERMENT PROGRAM STATS ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to load program statistics.",
    });
  }
};


const createDisbursementPreview = async (req, res) => {
  try {
    const { programId } = req.params;

    const program =
      await EmpowermentProgram.findById(
        programId
      );

    if (!program) {
      return res.status(404).json({
        success: false,
        message:
          "Empowerment program not found.",
      });
    }

    if (
      !["APPROVED", "DISBURSING"].includes(
        String(program.status || "").toUpperCase()
      )
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Program must be APPROVED before disbursement.",
      });
    }

    const beneficiaries =
      await EmpowermentBeneficiary.find({
        program: program._id,
        applicationStatus: "APPROVED",
      }).sort({ createdAt: 1 });

    if (!beneficiaries.length) {
      return res.status(400).json({
        success: false,
        message:
          "No approved beneficiaries are available for disbursement.",
      });
    }

    const amountPerBeneficiary =
      Number(program.amountPerBeneficiary || 0);

    const totalAmount =
      beneficiaries.length *
      amountPerBeneficiary;

    if (totalAmount <= 0) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid disbursement amount.",
      });
    }

    const timestamp =
      Date.now().toString();

    const random =
      Math.random()
        .toString(36)
        .substring(2, 8)
        .toUpperCase();

    const batchReference =
      `EMP-${timestamp}-${random}`;

    const batch =
      await EmpowermentDisbursement.create({
        program: program._id,
        batchReference,
        beneficiaryCount:
          beneficiaries.length,
        amountPerBeneficiary,
        totalAmount,
        status: "PREVIEW",
        beneficiaryIds:
          beneficiaries.map(
            (item) => item._id
          ),
        createdBy:
          req.user?._id || null,
        metadata: {
          safeMode: true,
          realMoneyMoved: false,
        },
      });

    return res.status(201).json({
      success: true,
      message:
        "Disbursement preview created successfully.",
      safeMode: true,
      realMoneyMoved: false,
      batch,
      preview: {
        beneficiaries:
          beneficiaries.length,
        amountPerBeneficiary,
        totalAmount,
      },
    });
  } catch (error) {
    console.error(
      "EMPOWERMENT DISBURSEMENT PREVIEW ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to create disbursement preview.",
    });
  }
};

const prepareDisbursementBatch = async (req, res) => {
  try {
    const { batchId } = req.params;

    const batch =
      await EmpowermentDisbursement.findById(
        batchId
      );

    if (!batch) {
      return res.status(404).json({
        success: false,
        message:
          "Disbursement batch not found.",
      });
    }

    if (batch.status !== "PREVIEW") {
      return res.status(400).json({
        success: false,
        message:
          "Only PREVIEW batches can be prepared.",
      });
    }

    const beneficiaries =
      await EmpowermentBeneficiary.find({
        _id: {
          $in: batch.beneficiaryIds,
        },
        applicationStatus: "APPROVED",
      });

    if (
      beneficiaries.length !==
      batch.beneficiaryIds.length
    ) {
      return res.status(409).json({
        success: false,
        message:
          "Some beneficiaries are no longer approved. Create a new preview.",
      });
    }

    await EmpowermentBeneficiary.updateMany(
      {
        _id: {
          $in: batch.beneficiaryIds,
        },
        applicationStatus: "APPROVED",
      },
      {
        $set: {
          applicationStatus:
            "PAYMENT_PENDING",
        },
      }
    );

    batch.status = "READY";

    batch.metadata = {
      ...(batch.metadata || {}),
      preparedAt:
        new Date().toISOString(),
      safeMode: true,
      realMoneyMoved: false,
    };

    await batch.save();

    return res.status(200).json({
      success: true,
      message:
        "Disbursement batch is ready in SAFE MODE.",
      safeMode: true,
      realMoneyMoved: false,
      batch,
    });
  } catch (error) {
    console.error(
      "PREPARE EMPOWERMENT DISBURSEMENT ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to prepare disbursement batch.",
    });
  }
};

const listDisbursementBatches = async (req, res) => {
  try {
    const { programId } = req.params;

    const batches =
      await EmpowermentDisbursement.find({
        program: programId,
      })
        .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: batches.length,
      batches,
    });
  } catch (error) {
    console.error(
      "LIST EMPOWERMENT DISBURSEMENTS ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to load disbursement batches.",
    });
  }
};


const getEmpowermentDashboardSummary = async (req, res) => {
  try {
    const [
      totalOrganizations,
      activeOrganizations,
      totalPrograms,
      activePrograms,
      totalBeneficiaries,
      approvedBeneficiaries,
      rejectedBeneficiaries,
      paidBeneficiaries,
      pendingBeneficiaries,
      programs,
      recentBeneficiaries,
      recentBatches,
    ] = await Promise.all([
      EmpowermentOrganization.countDocuments(),

      EmpowermentOrganization.countDocuments({
        status: "ACTIVE",
      }),

      EmpowermentProgram.countDocuments(),

      EmpowermentProgram.countDocuments({
        status: {
          $in: [
            "OPEN",
            "APPROVED",
            "DISBURSING",
          ],
        },
      }),

      EmpowermentBeneficiary.countDocuments(),

      EmpowermentBeneficiary.countDocuments({
        applicationStatus: "APPROVED",
      }),

      EmpowermentBeneficiary.countDocuments({
        applicationStatus: "REJECTED",
      }),

      EmpowermentBeneficiary.countDocuments({
        applicationStatus: "PAID",
      }),

      EmpowermentBeneficiary.countDocuments({
        applicationStatus: {
          $in: [
            "SUBMITTED",
            "UNDER_REVIEW",
            "PAYMENT_PENDING",
          ],
        },
      }),

      EmpowermentProgram.find()
        .select(
          "totalBudget totalDisbursedAmount status"
        )
        .lean(),

      EmpowermentBeneficiary.find()
        .populate(
          "program",
          "name organization"
        )
        .sort({ createdAt: -1 })
        .limit(10)
        .lean(),

      EmpowermentDisbursement.find()
        .populate(
          "program",
          "name"
        )
        .sort({ createdAt: -1 })
        .limit(10)
        .lean(),
    ]);

    let totalBudget = 0;
    let totalDisbursed = 0;

    for (const program of programs) {
      totalBudget +=
        Number(program.totalBudget || 0);

      totalDisbursed +=
        Number(
          program.totalDisbursedAmount || 0
        );
    }

    return res.status(200).json({
      success: true,

      summary: {
        organizations: {
          total: totalOrganizations,
          active: activeOrganizations,
        },

        programs: {
          total: totalPrograms,
          active: activePrograms,
        },

        beneficiaries: {
          total: totalBeneficiaries,
          approved:
            approvedBeneficiaries,
          rejected:
            rejectedBeneficiaries,
          paid:
            paidBeneficiaries,
          pending:
            pendingBeneficiaries,
        },

        financials: {
          totalBudget,
          totalDisbursed,
          remainingBudget:
            Math.max(
              0,
              totalBudget -
              totalDisbursed
            ),
        },
      },

      recentActivity: {
        beneficiaries:
          recentBeneficiaries,
        disbursementBatches:
          recentBatches,
      },

      safeMode: true,
      realMoneyMoved: false,
    });
  } catch (error) {
    console.error(
      "EMPOWERMENT DASHBOARD SUMMARY ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to load empowerment dashboard.",
    });
  }
};

const getEmpowermentAuditTrail = async (req, res) => {
  try {
    const limit = Math.min(
      Number(req.query?.limit || 50),
      200
    );

    const [
      beneficiaries,
      programs,
      batches,
    ] = await Promise.all([
      EmpowermentBeneficiary.find()
        .sort({ updatedAt: -1 })
        .limit(limit)
        .select(
          "fullName phone applicationStatus amount program createdAt updatedAt"
        )
        .populate(
          "program",
          "name"
        )
        .lean(),

      EmpowermentProgram.find()
        .sort({ updatedAt: -1 })
        .limit(limit)
        .select(
          "name status totalBudget totalDisbursedAmount createdAt updatedAt"
        )
        .lean(),

      EmpowermentDisbursement.find()
        .sort({ updatedAt: -1 })
        .limit(limit)
        .select(
          "batchReference status beneficiaryCount totalAmount program createdBy createdAt updatedAt metadata"
        )
        .populate(
          "program",
          "name"
        )
        .lean(),
    ]);

    const activity = [];

    for (const item of beneficiaries) {
      activity.push({
        type: "BENEFICIARY",
        action:
          item.applicationStatus,
        reference:
          item._id,
        name:
          item.fullName,
        program:
          item.program?.name || "",
        amount:
          Number(item.amount || 0),
        createdAt:
          item.createdAt,
        updatedAt:
          item.updatedAt,
      });
    }

    for (const item of programs) {
      activity.push({
        type: "PROGRAM",
        action:
          item.status,
        reference:
          item._id,
        name:
          item.name,
        amount:
          Number(
            item.totalBudget || 0
          ),
        createdAt:
          item.createdAt,
        updatedAt:
          item.updatedAt,
      });
    }

    for (const item of batches) {
      activity.push({
        type: "DISBURSEMENT_BATCH",
        action:
          item.status,
        reference:
          item.batchReference,
        program:
          item.program?.name || "",
        beneficiaryCount:
          Number(
            item.beneficiaryCount || 0
          ),
        amount:
          Number(
            item.totalAmount || 0
          ),
        safeMode:
          item.metadata?.safeMode === true,
        realMoneyMoved:
          item.metadata?.realMoneyMoved === true,
        createdAt:
          item.createdAt,
        updatedAt:
          item.updatedAt,
      });
    }

    activity.sort(
      (a, b) =>
        new Date(b.updatedAt || 0) -
        new Date(a.updatedAt || 0)
    );

    return res.status(200).json({
      success: true,
      count:
        Math.min(
          activity.length,
          limit
        ),
      activity:
        activity.slice(0, limit),
    });
  } catch (error) {
    console.error(
      "EMPOWERMENT AUDIT TRAIL ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to load empowerment audit trail.",
    });
  }
};

module.exports = {
  listOrganizations,
  createOrganization,
  createProgram,
  addBeneficiary,
  listPrograms,
  listBeneficiaries,
  updateOrganizationStatus,
  updateProgramStatus,
  updateBeneficiaryStatus,
  applyForProgram,
  getMyApplications,
  listAvailablePrograms,
  bulkAddBeneficiaries,
  getProgramStatistics,
  createDisbursementPreview,
  prepareDisbursementBatch,
  listDisbursementBatches,
  getEmpowermentDashboardSummary,
  getEmpowermentAuditTrail,
};
