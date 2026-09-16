const mongoose = require("mongoose");

const money = (defaultValue = 0) => ({
  type: Number,
  min: 0,
  default: defaultValue,
  set: (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100,
});

const immutableSchema = (definition, options = {}) => {
  const schema = new mongoose.Schema(definition, {
    timestamps: true,
    versionKey: "version",
    ...options,
  });
  schema.pre(["findOneAndUpdate", "updateOne", "updateMany", "replaceOne"], function () {
    const update = this.getUpdate() || {};
    const allowed = options.mutablePaths || [];
    const paths = Object.keys(update.$set || {}).concat(Object.keys(update.$unset || {}));
    const illegal = paths.filter((path) => !allowed.some((allowedPath) => path === allowedPath || path.startsWith(`${allowedPath}.`)));
    if (illegal.length) throw new Error(`Immutable EduPay record fields cannot be changed: ${illegal.join(", ")}`);
  });
  schema.pre(["deleteOne", "deleteMany", "findOneAndDelete"], function () {
    throw new Error("EduPay financial records cannot be deleted.");
  });
  return schema;
};

module.exports = { mongoose, money, immutableSchema };