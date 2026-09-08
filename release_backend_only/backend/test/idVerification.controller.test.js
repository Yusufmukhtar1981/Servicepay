const test = require("node:test");
const assert = require("node:assert/strict");

process.env.PREMBLY_SECRET_KEY = "test-secret";

const axios = require("axios");
const IdVerification = require("../models/idVerification.model");
const Transaction = require("../models/transaction.model");
const User = require("../models/user.model");
const {
  extractNinData,
  normalizeNinSlipType,
  verifyNin,
} = require("../controllers/idVerification.controller");

test("all NIN slip inputs normalize to PREMIUM", () => {
  for (const value of [
    undefined,
    "PREMIUM",
    "STANDARD",
    "REGULAR",
    "INFORMATION",
    "BASIC",
    "unexpected",
  ]) {
    assert.equal(normalizeNinSlipType(value), "PREMIUM");
  }
});

test("maps provider identity fields from nested NIN data", () => {
  const result = extractNinData({
    data: {
      data: {
        firstname: "Ada",
        middlename: "Nneka",
        surname: "Okafor",
        birthdate: "1992-04-15",
        gender: "Female",
        nin: "12345678901",
        telephoneno: "08012345678",
        residence_address: "12 Unity Road",
        self_origin_state: "Enugu",
        self_origin_lga: "Nsukka",
        nationality: "Nigerian",
        date_of_issue: "2020-01-10",
        photo: "data:image/jpeg;base64,photo",
      },
    },
  });

  assert.deepEqual(result, {
    fullName: "Ada Nneka Okafor",
    firstName: "Ada",
    middleName: "Nneka",
    lastName: "Okafor",
    nin: "12345678901",
    phone: "08012345678",
    gender: "Female",
    dateOfBirth: "1992-04-15",
    address: "12 Unity Road",
    stateOfOrigin: "Enugu",
    lga: "Nsukka",
    photo: "data:image/jpeg;base64,photo",
    nationality: "Nigerian",
    dateOfIssue: "2020-01-10",
  });
});

test("maps camelCase-only provider identity payloads", () => {
  const result = extractNinData({
    response: {
      data: {
        firstName: "Ada",
        middleName: "Nneka",
        lastName: "Okafor",
        fullName: "Ada Nneka Okafor",
        dateOfBirth: "1992-04-15",
        id_number: "12345678901",
        phone_number: "08012345678",
        passport_photo: "provider-photo",
      },
    },
  });

  assert.equal(result.fullName, "Ada Nneka Okafor");
  assert.equal(result.firstName, "Ada");
  assert.equal(result.middleName, "Nneka");
  assert.equal(result.lastName, "Okafor");
  assert.equal(result.dateOfBirth, "1992-04-15");
  assert.equal(result.nin, "12345678901");
  assert.equal(result.phone, "08012345678");
  assert.equal(result.photo, "provider-photo");
});

test("legacy client input is charged and stored as PREMIUM", async () => {
  const originals = {
    axiosPost: axios.post,
    createVerification: IdVerification.create,
    createTransaction: Transaction.create,
    findUser: User.findById,
  };

  const created = [];
  const transactions = [];
  const user = {
    _id: "user-1",
    walletBalance: 1000,
    async save() {},
  };

  try {
    User.findById = async () => user;
    IdVerification.create = async (payload) => {
      created.push(payload);
      return {
        _id: "verification-1",
        ...payload,
        verificationData: {},
        async save() {},
      };
    };
    Transaction.create = async (payload) => {
      transactions.push(payload);
      return payload;
    };
    axios.post = async () => ({
      data: {
        data: {
          firstname: "Ada",
          middlename: "Nneka",
          surname: "Okafor",
          birthdate: "1992-04-15",
          gender: "Female",
          photo: "provider-photo",
        },
      },
    });

    const result = {};
    const response = {
      status(code) {
        result.status = code;
        return this;
      },
      json(payload) {
        result.body = payload;
        return this;
      },
    };

    await verifyNin(
      {
        user: { id: "user-1" },
        body: {
          ninNumber: "12345678901",
          slipType: "REGULAR",
          searchType: "NIN_NUMBER",
          consentAccepted: true,
        },
      },
      response,
    );

    assert.equal(result.status, 200);
    assert.equal(created.length, 1);
    assert.equal(created[0].slipType, "PREMIUM");
    assert.equal(created[0].amountCharged, 250);
    assert.equal(user.walletBalance, 750);
    assert.equal(transactions.length, 1);
    assert.equal(transactions[0].meta.slipType, "PREMIUM");
    assert.equal(result.body.data.slipType, "PREMIUM");
    assert.equal(result.body.data.verificationData.firstName, "Ada");
    assert.equal(result.body.data.verificationData.middleName, "Nneka");
    assert.equal(result.body.data.verificationData.lastName, "Okafor");
    assert.equal(result.body.data.verificationData.photo, "provider-photo");
  } finally {
    axios.post = originals.axiosPost;
    IdVerification.create = originals.createVerification;
    Transaction.create = originals.createTransaction;
    User.findById = originals.findUser;
  }
});
