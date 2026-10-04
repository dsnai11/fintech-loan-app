import mongoose from 'mongoose';

// A staff role and the permissions it grants. The built-in roles are seeded once and can then be edited;
// the super admin can also create custom roles.
const roleSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, match: /^[a-z][a-z0-9_]{1,39}$/ },
    label: { type: String, required: true, maxlength: 60 },
    description: { type: String, default: '', maxlength: 300 },
    permissions: { type: [String], default: [] },
    builtin: { type: Boolean, default: false },
    updatedBy: String,
  },
  { timestamps: true }
);

export default mongoose.model('Role', roleSchema);
