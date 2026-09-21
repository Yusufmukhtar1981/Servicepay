/* eslint-disable no-console */
require("dotenv").config();
const mongoose = require("mongoose");
const Child = require("../backend/models/edupayChild.model");
const { EduPayStudent } = require("../backend/models/edupayAcademicManagement.model");
const { persistLink, admissionPattern } = require("../backend/services/edupayStudentLink.service");

async function main() {
  const apply = process.argv.includes("--apply");
  if (!process.env.MONGODB_URI) throw new Error("Required MongoDB environment variable is missing: MONGODB_URI");
  await mongoose.connect(process.env.MONGODB_URI);
  const children = await Child.find({ status: "ACTIVE" }).lean();
  const summary = { dryRun: !apply, scanned: children.length, alreadyLinked: 0, matched: 0, linked: 0, missing: 0, ambiguous: 0, conflict: 0 };
  for (const child of children) {
    if (child.academicStudent) {
      const existing = await EduPayStudent.findOne({ _id: child.academicStudent, school: child.school, status: "ACTIVE" }).select("_id").lean();
      if (existing) summary.alreadyLinked += 1;
      else summary.conflict += 1;
      continue;
    }
    const pattern = admissionPattern(child.admissionNumber);
    if (!pattern) { summary.missing += 1; continue; }
    const matches = await EduPayStudent.find({ school: child.school, studentId: pattern, status: "ACTIVE" }).limit(2).lean();
    if (matches.length !== 1) {
      summary[matches.length ? "ambiguous" : "missing"] += 1;
      continue;
    }
    summary.matched += 1;
    if (apply) {
      await persistLink(child, matches[0], "BACKFILL", null, { strict: true });
      summary.linked += 1;
    }
  }
  console.log(JSON.stringify(summary, null, 2));
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error.message);
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});