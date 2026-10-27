const test = require("node:test");
const assert = require("node:assert/strict");

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

test("NIN rejects non-digit input and non-boolean consent before database or provider access", async () => {
  for (const body of [
    { ninNumber: "ABCDEFGHIJK", consentAccepted: true },
    { ninNumber: 12345678901, consentAccepted: true },
    { ninNumber: "12345678901", consentAccepted: "false" },
  ]) {
    const response = { status(code) { this.code = code; return this; },
      json(payload) { this.body = payload; return this; } };
    await verifyNin({ user: { id: "unused-fixture-id" }, body }, response);
    assert.equal(response.code, 400);
    assert.equal(response.body.success, false);
  }
});
