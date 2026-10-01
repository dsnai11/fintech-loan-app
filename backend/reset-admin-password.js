import mongoose from 'mongoose';
import bcryptjs from 'bcryptjs';
import dotenv from 'dotenv';

dotenv.config();

const userSchema = new mongoose.Schema({
  firstName: String,
  lastName: String,
  email: { type: String, unique: true, lowercase: true },
  phone: { type: String, unique: true },
  password: String,
  phoneVerified: { type: Boolean, default: false },
  status: { type: String, default: 'active' },
}, { timestamps: true });

const User = mongoose.model('User', userSchema);

async function resetAdminPassword(newPassword) {
  try {
    const mongoUrl = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/fintech-loan';
    await mongoose.connect(mongoUrl);
    console.log('Connected to MongoDB');

    const adminEmail = 'admin@lifc.in';
    let user = await User.findOne({ email: adminEmail });

    if (!user) {
      console.log('Admin user not found. Creating new admin account...');
      const salt = await bcryptjs.genSalt(10);
      const hashedPassword = await bcryptjs.hash(newPassword, salt);

      user = new User({
        firstName: 'Admin',
        lastName: 'LIFC',
        email: adminEmail,
        phone: '9999999999',
        password: hashedPassword,
        phoneVerified: true,
        status: 'active'
      });
      await user.save();
      console.log('✅ Admin account created successfully');
    } else {
      console.log('Admin user found. Updating password...');
      const salt = await bcryptjs.genSalt(10);
      user.password = await bcryptjs.hash(newPassword, salt);
      await user.save();
      console.log('✅ Admin password updated successfully');
    }

    console.log(`\n📋 Admin Credentials:`);
    console.log(`Email: ${adminEmail}`);
    console.log(`Password: ${newPassword}`);
    console.log(`\n✅ You can now log in to the admin panel with these credentials`);

    await mongoose.connection.close();
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

const newPassword = process.argv[2] || 'Admin@123456';
resetAdminPassword(newPassword);
