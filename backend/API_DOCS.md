# FinTech Loan API Documentation

Base URL: `http://localhost:5000/api`

## Authentication
All protected endpoints require JWT token in header:
```
Authorization: Bearer <token>
```

## Endpoints

### Authentication

#### POST /auth/signup
Register a new user.

**Request:**
```json
{
  "firstName": "John",
  "lastName": "Doe",
  "email": "john@example.com",
  "phone": "9876543210",
  "password": "password123",
  "confirmPassword": "password123"
}
```

**Response:**
```json
{
  "message": "User registered successfully",
  "token": "eyJhbGc...",
  "user": {
    "id": "user_id",
    "firstName": "John",
    "lastName": "Doe",
    "email": "john@example.com",
    "phone": "9876543210"
  }
}
```

#### POST /auth/login
Login user.

**Request:**
```json
{
  "email": "john@example.com",
  "password": "password123"
}
```

**Response:**
```json
{
  "message": "Login successful",
  "token": "eyJhbGc...",
  "user": {
    "id": "user_id",
    "firstName": "John",
    "lastName": "Doe",
    "email": "john@example.com",
    "phone": "9876543210"
  }
}
```

### Users

#### GET /users/profile
Get user profile. **[Protected]**

**Response:**
```json
{
  "_id": "user_id",
  "firstName": "John",
  "lastName": "Doe",
  "email": "john@example.com",
  "phone": "9876543210",
  "employment": {
    "status": "Employed",
    "company": "TechCorp",
    "monthlyIncome": 50000
  },
  "kycStatus": "pending"
}
```

#### PUT /users/profile
Update user profile. **[Protected]**

**Request:**
```json
{
  "firstName": "John",
  "lastName": "Doe",
  "phone": "9876543210",
  "dateOfBirth": "1990-01-15",
  "gender": "Male",
  "address": {
    "street": "123 Main St",
    "city": "Mumbai",
    "state": "Maharashtra",
    "zipCode": "400001",
    "country": "India"
  },
  "employment": {
    "status": "Employed",
    "company": "TechCorp",
    "designation": "Software Engineer",
    "monthlyIncome": 50000,
    "yearsOfExperience": 5
  }
}
```

### Loans

#### POST /loans/apply
Apply for a new loan. **[Protected]**

**Request:**
```json
{
  "loanAmount": 100000,
  "tenure": 12,
  "purpose": "Personal",
  "loanType": "Personal Loan"
}
```

**Response:**
```json
{
  "message": "Loan application submitted",
  "loan": {
    "id": "loan_id",
    "loanAmount": 100000,
    "tenure": 12,
    "monthlyEMI": 8992,
    "totalAmount": 107904,
    "status": "submitted",
    "interestRate": 15
  }
}
```

#### GET /loans
Get all user loans. **[Protected]**

**Response:**
```json
[
  {
    "_id": "loan_id",
    "loanAmount": 100000,
    "tenure": 12,
    "monthlyEMI": 8992,
    "status": "submitted",
    "applicationDate": "2024-01-15T10:00:00Z"
  }
]
```

#### GET /loans/:loanId
Get specific loan details. **[Protected]**

**Response:**
```json
{
  "_id": "loan_id",
  "loanAmount": 100000,
  "tenure": 12,
  "monthlyEMI": 8992,
  "totalAmount": 107904,
  "status": "submitted",
  "purpose": "Personal",
  "interestRate": 15,
  "applicationDate": "2024-01-15T10:00:00Z"
}
```

## Status Codes
- `200`: Success
- `201`: Created
- `400`: Bad Request
- `401`: Unauthorized
- `403`: Forbidden
- `404`: Not Found
- `500`: Server Error
