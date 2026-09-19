const { mongoose } = require("./edupayModelUtils");

const auditFields = {
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
};
const schoolRef = { type: mongoose.Schema.Types.ObjectId, ref: "EduPaySchool", required: true, index: true, immutable: true };

const subjectSchema = new mongoose.Schema({
  school: schoolRef,
  name: { type: String, required: true, trim: true, maxlength: 120 },
  code: { type: String, trim: true, uppercase: true, maxlength: 30 },
  status: { type: String, enum: ["ACTIVE", "INACTIVE"], default: "ACTIVE", index: true },
  ...auditFields,
}, { timestamps: true });
subjectSchema.index({ school: 1, name: 1 }, { unique: true });

const studentSchema = new mongoose.Schema({
  school: schoolRef,
  studentId: { type: String, required: true, trim: true, uppercase: true, maxlength: 80 },
  fullName: { type: String, required: true, trim: true, maxlength: 180 },
  firstName: { type: String, trim: true, maxlength: 80 },
  middleName: { type: String, trim: true, maxlength: 80 },
  lastName: { type: String, trim: true, maxlength: 80 },
  gender: { type: String, trim: true, maxlength: 30 },
  dateOfBirth: Date,
  classLevel: { type: mongoose.Schema.Types.ObjectId, ref: "EduPayClass", default: null, index: true },
  parent: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
  parentName: { type: String, trim: true, maxlength: 160 },
  parentPhone: { type: String, trim: true, maxlength: 40 },
  parentEmail: { type: String, trim: true, lowercase: true, maxlength: 180 },
  admissionDate: Date,
  status: { type: String, enum: ["ACTIVE", "INACTIVE", "GRADUATED", "TRANSFERRED"], default: "ACTIVE", index: true },
  ...auditFields,
}, { timestamps: true });
studentSchema.index({ school: 1, studentId: 1 }, { unique: true });
studentSchema.index({ school: 1, classLevel: 1, status: 1 });

const teacherSchema = new mongoose.Schema({
  school: schoolRef,
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, immutable: true, index: true },
  staffId: { type: String, required: true, trim: true, uppercase: true, maxlength: 80 },
  fullName: { type: String, required: true, trim: true, maxlength: 180 },
  phone: { type: String, trim: true, maxlength: 40 },
  email: { type: String, trim: true, lowercase: true, maxlength: 180 },
  status: { type: String, enum: ["ACTIVE", "INACTIVE"], default: "ACTIVE", index: true },
  ...auditFields,
}, { timestamps: true });
teacherSchema.index({ school: 1, staffId: 1 }, { unique: true });
teacherSchema.index({ school: 1, user: 1 }, { unique: true });

const assignmentSchema = new mongoose.Schema({
  school: schoolRef,
  teacher: { type: mongoose.Schema.Types.ObjectId, ref: "EduPayTeacher", required: true, index: true },
  classLevel: { type: mongoose.Schema.Types.ObjectId, ref: "EduPayClass", required: true, index: true },
  subject: { type: mongoose.Schema.Types.ObjectId, ref: "EduPaySubject", required: true, index: true },
  ...auditFields,
}, { timestamps: true });
assignmentSchema.index({ school: 1, teacher: 1, classLevel: 1, subject: 1 }, { unique: true });

const attendanceSchema = new mongoose.Schema({
  school: schoolRef,
  classLevel: { type: mongoose.Schema.Types.ObjectId, ref: "EduPayClass", required: true, index: true },
  session: { type: mongoose.Schema.Types.ObjectId, ref: "EduPayAcademicSession", required: true, index: true },
  term: { type: mongoose.Schema.Types.ObjectId, ref: "EduPayTerm", required: true, index: true },
  student: { type: mongoose.Schema.Types.ObjectId, ref: "EduPayStudent", required: true, index: true },
  date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/, index: true },
  status: { type: String, enum: ["PRESENT", "ABSENT", "LATE", "EXCUSED"], required: true },
  teacher: { type: mongoose.Schema.Types.ObjectId, ref: "EduPayTeacher", default: null },
  correctedAt: { type: Date, default: null },
  correctedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  ...auditFields,
}, { timestamps: true });
attendanceSchema.index({ school: 1, classLevel: 1, student: 1, date: 1, session: 1, term: 1 }, { unique: true });

const assessmentSchema = new mongoose.Schema({
  school: schoolRef,
  session: { type: mongoose.Schema.Types.ObjectId, ref: "EduPayAcademicSession", required: true, index: true },
  term: { type: mongoose.Schema.Types.ObjectId, ref: "EduPayTerm", required: true, index: true },
  classLevel: { type: mongoose.Schema.Types.ObjectId, ref: "EduPayClass", required: true, index: true },
  subject: { type: mongoose.Schema.Types.ObjectId, ref: "EduPaySubject", required: true, index: true },
  title: { type: String, required: true, trim: true, maxlength: 120 },
  components: [{ name: { type: String, required: true, trim: true }, max: { type: Number, required: true, min: 0 } }],
  grading: [{ grade: String, min: { type: Number, min: 0 }, max: { type: Number, max: 100 }, remark: String }],
  rankingEnabled: { type: Boolean, default: false },
  status: { type: String, enum: ["DRAFT", "SUBMITTED", "RETURNED", "APPROVED", "PUBLISHED"], default: "DRAFT", index: true },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  reviewedAt: { type: Date, default: null },
  reviewNote: { type: String, maxlength: 1000 },
  ...auditFields,
}, { timestamps: true });
assessmentSchema.index({ school: 1, session: 1, term: 1, classLevel: 1, subject: 1, title: 1 }, { unique: true });

const scoreSchema = new mongoose.Schema({
  school: schoolRef,
  assessment: { type: mongoose.Schema.Types.ObjectId, ref: "EduPayAssessment", required: true, index: true },
  student: { type: mongoose.Schema.Types.ObjectId, ref: "EduPayStudent", required: true, index: true },
  teacher: { type: mongoose.Schema.Types.ObjectId, ref: "EduPayTeacher", default: null },
  values: { type: mongoose.Schema.Types.Mixed, default: {} },
  total: { type: Number, min: 0, default: 0 },
  percentage: { type: Number, min: 0, max: 100, default: 0 },
  grade: { type: String, default: null },
  remark: { type: String, default: null },
  status: { type: String, enum: ["DRAFT", "SUBMITTED"], default: "DRAFT", index: true },
  ...auditFields,
}, { timestamps: true });
scoreSchema.index({ school: 1, assessment: 1, student: 1 }, { unique: true });

const timetableSchema = new mongoose.Schema({
  school: schoolRef,
  session: { type: mongoose.Schema.Types.ObjectId, ref: "EduPayAcademicSession", required: true, index: true },
  term: { type: mongoose.Schema.Types.ObjectId, ref: "EduPayTerm", required: true, index: true },
  classLevel: { type: mongoose.Schema.Types.ObjectId, ref: "EduPayClass", required: true, index: true },
  subject: { type: mongoose.Schema.Types.ObjectId, ref: "EduPaySubject", required: true },
  teacher: { type: mongoose.Schema.Types.ObjectId, ref: "EduPayTeacher", required: true },
  day: { type: String, enum: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"], required: true },
  period: { type: String, trim: true, maxlength: 40 },
  startsAt: String,
  endsAt: String,
  ...auditFields,
}, { timestamps: true });
timetableSchema.index({ school: 1, session: 1, term: 1, classLevel: 1, day: 1, startsAt: 1 });

const activitySchema = new mongoose.Schema({
  school: schoolRef,
  type: { type: String, enum: ["ACTIVITY", "ANNOUNCEMENT"], required: true, index: true },
  title: { type: String, required: true, trim: true, maxlength: 180 },
  body: { type: String, required: true, trim: true, maxlength: 5000 },
  eventDate: Date,
  audience: { type: String, enum: ["SCHOOL", "CLASS", "STUDENT"], default: "SCHOOL" },
  classLevel: { type: mongoose.Schema.Types.ObjectId, ref: "EduPayClass", default: null },
  student: { type: mongoose.Schema.Types.ObjectId, ref: "EduPayStudent", default: null },
  status: { type: String, enum: ["DRAFT", "PUBLISHED"], default: "PUBLISHED", index: true },
  ...auditFields,
}, { timestamps: true });
activitySchema.index({ school: 1, status: 1, createdAt: -1 });

module.exports = {
  EduPaySubject: mongoose.model("EduPaySubject", subjectSchema),
  EduPayStudent: mongoose.model("EduPayStudent", studentSchema),
  EduPayTeacher: mongoose.model("EduPayTeacher", teacherSchema),
  EduPayTeacherAssignment: mongoose.model("EduPayTeacherAssignment", assignmentSchema),
  EduPayAttendance: mongoose.model("EduPayAttendance", attendanceSchema),
  EduPayAssessment: mongoose.model("EduPayAssessment", assessmentSchema),
  EduPayScore: mongoose.model("EduPayScore", scoreSchema),
  EduPayTimetable: mongoose.model("EduPayTimetable", timetableSchema),
  EduPayAcademicActivity: mongoose.model("EduPayAcademicActivity", activitySchema),
};