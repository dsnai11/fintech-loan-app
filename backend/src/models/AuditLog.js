import mongoose from 'mongoose';

const auditLogSchema = new mongoose.Schema(
  {
    seq: { type: Number, required: true, unique: true },
    prevHash: { type: String, required: true },
    hash: { type: String, required: true },
    at: { type: String, required: true },
    actor: { type: String, required: true },
    role: { type: String, required: true }, // admin, customer, system, or a staff role name
    action: { type: String, required: true, index: true },
    entityType: { type: String, default: '' },
    entityId: { type: String, default: '' },
    details: { type: mongoose.Schema.Types.Mixed, default: {} },
    ip: { type: String, default: '' },
  },
  { versionKey: false, minimize: false }
);

auditLogSchema.index({ entityType: 1, entityId: 1 });
auditLogSchema.index({ actor: 1, seq: -1 });

// Audit entries are append-only. Block every update and delete path.
const blocked = function (next) {
  next(new Error('Audit log entries cannot be changed or deleted'));
};
for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'findOneAndReplace', 'replaceOne', 'findOneAndDelete', 'deleteOne', 'deleteMany']) {
  auditLogSchema.pre(op, blocked);
}
auditLogSchema.pre('save', function (next) {
  if (!this.isNew) return next(new Error('Audit log entries cannot be changed or deleted'));
  next();
});

export default mongoose.model('AuditLog', auditLogSchema);
