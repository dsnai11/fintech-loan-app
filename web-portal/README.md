# LIFC Loan Portal - Web Application

A fully functional web portal for the LIFC fintech loan application system. Connects directly to the production backend API.

## Features

- **Dashboard**: Overview of your loans, KYC status, and applications
- **Loan Applications**: View all your loan applications with status tracking
- **Profile Management**: View and manage your personal information
- **KYC Verification**: Verify PAN and complete identity verification
- **Bank Details**: Add and verify your bank account
- **Apply for Loan**: Submit new loan applications with customized terms

## Getting Started

### Local Development

```bash
# Start the web portal server (runs on port 3000)
node server.js
```

Then open your browser to `http://localhost:3000`

### Production Access

- **Local Network**: `http://YOUR_IP:3000`
- **Backend**: `https://fintech-loan-app-production.up.railway.app/api`

## How to Use

1. **Get Your Token**: 
   - Sign up or log in via the mobile app (APK/IPA)
   - Go to your profile and copy your JWT token (from API response)
   
2. **Connect to Portal**:
   - Open the web portal
   - Paste your JWT token in the "Paste JWT token here" field
   - Click "Connect"

3. **Use the Portal**:
   - View your dashboard
   - Check loan applications
   - Complete KYC verification
   - Apply for new loans
   - Manage bank details

## API Integration

The portal connects to these endpoints:

- `GET /api/users/profile` - Get user profile
- `GET /api/loans` - List all loans
- `POST /api/loans/apply` - Apply for a loan
- `POST /api/kyc/pan` - Verify PAN
- `POST /api/kyc/bank` - Verify bank details
- `POST /api/kyc/otp/send` - Send OTP
- `POST /api/kyc/otp/verify` - Verify OTP

## Architecture

- **Frontend**: Pure HTML/CSS/JavaScript (no dependencies)
- **Backend**: Node.js/Express on Railway
- **Database**: MongoDB on Railway
- **Authentication**: JWT Bearer tokens

## Browser Support

- Chrome/Chromium (recommended)
- Firefox
- Safari
- Edge

## Troubleshooting

**"No token provided" error**
- Make sure you pasted a valid JWT token from your mobile app

**API returns 404**
- Verify the backend URL is correct
- Check your internet connection

**Port 3000 already in use**
- Change PORT in server.js to another port (e.g., 3001)

## File Structure

```
web-portal/
├── index.html    # Complete web app (all-in-one)
├── server.js     # Node.js HTTP server
└── README.md     # This file
```

## Development Notes

The entire application is contained in a single `index.html` file for easy deployment. All styling and JavaScript are embedded.

To customize:
1. Edit the HTML file directly
2. Restart the server
3. Changes take effect immediately

## Security

- All traffic to the backend uses HTTPS
- JWT tokens are stored in localStorage (clear your browser cache to log out)
- CORS is enabled for all origins (adjust in server.js for production)

## Support

For issues with:
- **Mobile App (APK/IPA)**: Check GitHub Issues
- **Backend API**: Check Railway logs
- **Web Portal**: Check browser console (F12)

---

**Version**: 1.0.0  
**Last Updated**: 2026-10-01  
**Status**: Production Ready
