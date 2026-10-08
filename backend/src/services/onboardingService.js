import { STATES } from './chargesEngine.js';

// Setting up an account: personal details, a photo that proves a real person, and the bank account the loan will
// be paid into. Together they are the "account setup" a customer finishes before they can apply for a loan.

const EMPLOYMENT = ['Employed', 'Self-Employed', 'Student', 'Unemployed'];
const GENDERS = ['Male', 'Female', 'Other'];

const ageOn = d => Math.floor((Date.now() - new Date(d).getTime()) / (365.25 * 86400000));

// What is still to do. A selfie waiting for staff to look at it counts as done; a rejected one does not.
export function setupStatus(user) {
  const a = user.address || {};
  const e = user.employment || {};
  const earns = e.status === 'Employed' || e.status === 'Self-Employed';
  const profile = !!(user.dateOfBirth && user.gender && a.street && a.city && a.state && /^\d{6}$/.test(String(a.zipCode || '')) && e.status && (!earns || e.monthlyIncome > 0));
  const selfie = !!user.selfie && ['passed', 'review'].includes(user.selfie.status);
  const b = user.bankAccount || {};
  const bank = !!(b.accountNumber && b.ifscCode && b.accountHolder);
  const kyc = !!user.kycDigilocker && ['verified', 'review'].includes(user.kycDigilocker.status);
  return { kyc, profile, selfie, bank, complete: kyc && profile && selfie && bank };
}

// Checks what the customer typed and turns it into the fields to save. Returns { errors, update }.
export function checkProfile(body, user = null) {
  const errors = [];
  const update = {};
  const b = body || {};

  if (!GENDERS.includes(b.gender)) errors.push('Choose your gender');
  else update.gender = b.gender;

  const dob = new Date(b.dateOfBirth);
  if (!b.dateOfBirth || Number.isNaN(dob.getTime())) errors.push('Enter your date of birth');
  else {
    const age = ageOn(dob);
    if (age < 18) errors.push('You must be at least 18 years old');
    else if (age > 100) errors.push('Check your date of birth');
    else if (user?.kycDigilocker?.dob && user.kycDigilocker.dob !== dob.toISOString().slice(0, 10)) errors.push('Your date of birth must match the one on your Aadhaar record (' + user.kycDigilocker.dob + ')');
    else update.dateOfBirth = dob;
  }

  const a = b.address || {};
  const street = String(a.street ?? '').trim();
  const city = String(a.city ?? '').trim();
  if (street.length < 5 || street.length > 200) errors.push('Enter your full address (5 to 200 characters)');
  else update['address.street'] = street;
  if (city.length < 2 || city.length > 60) errors.push('Enter your city');
  else update['address.city'] = city;
  if (!STATES.includes(a.state)) errors.push('Choose your state');
  else update['address.state'] = a.state;
  if (!/^[1-9]\d{5}$/.test(String(a.zipCode ?? ''))) errors.push('Enter a 6-digit PIN code');
  else update['address.zipCode'] = String(a.zipCode);
  update['address.country'] = 'India';

  const e = b.employment || {};
  if (!EMPLOYMENT.includes(e.status)) errors.push('Choose what you do for work');
  else {
    update['employment.status'] = e.status;
    const earns = e.status === 'Employed' || e.status === 'Self-Employed';
    const income = Number(e.monthlyIncome);
    if (earns) {
      if (!Number.isFinite(income) || income <= 0 || income > 100000000) errors.push('Enter your monthly income in rupees');
      else update['employment.monthlyIncome'] = Math.round(income);
      const company = String(e.company ?? '').trim();
      if (company.length > 100) errors.push('The employer or business name is too long');
      else update['employment.company'] = company;
    } else {
      update['employment.monthlyIncome'] = Number.isFinite(income) && income > 0 ? Math.round(income) : 0;
      update['employment.company'] = '';
    }
  }
  return { errors, update };
}

export default { setupStatus, checkProfile };
