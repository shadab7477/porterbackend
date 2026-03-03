# Mobile OTP Authentication API Documentation

## Overview
Mobile OTP-based authentication for customer application login and signup.

---

## Authentication Endpoints

### 1. Send OTP
Send OTP to mobile number for verification.

**Endpoint:** `POST /api/auth/mobile/send-otp`

**Request Body:**
```json
{
  "mobile": "9876543210"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "OTP sent successfully",
  "data": {
    "mobile": "9876543210",
    "expiresIn": "15 minutes"
  }
}
```

**Error Response (400):**
```json
{
  "success": false,
  "message": "Please provide valid 10-digit mobile number"
}
```

---

### 2. Verify OTP
Verify OTP and login/signup customer.

**Endpoint:** `POST /api/auth/mobile/verify-otp`

**Request Body:**
```json
{
  "mobile": "9876543210",
  "otp": "123456"
}
```

**Success Response - New Customer (200):**
```json
{
  "success": true,
  "message": "Account created successfully",
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "customer": {
      "id": "65a1b2c3d4e5f6a7b8c9d0e1",
      "phone": "9876543210",
      "name": null,
      "email": null,
      "isNewCustomer": true
    }
  }
}
```

**Success Response - Existing Customer (200):**
```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "customer": {
      "id": "65a1b2c3d4e5f6a7b8c9d0e1",
      "phone": "9876543210",
      "name": "John Doe",
      "email": "john@example.com",
      "isNewCustomer": false
    }
  }
}
```

**Error Response - Invalid OTP (400):**
```json
{
  "success": false,
  "message": "Invalid OTP",
  "data": {
    "attemptsRemaining": 2
  }
}
```

**Error Response - Max Attempts (400):**
```json
{
  "success": false,
  "message": "Maximum attempts exceeded. Please request new OTP"
}
```

**Error Response - OTP Expired (400):**
```json
{
  "success": false,
  "message": "OTP expired or not found. Please request new OTP"
}
```

---

### 3. Resend OTP
Resend OTP to mobile number.

**Endpoint:** `POST /api/auth/mobile/resend-otp`

**Request Body:**
```json
{
  "mobile": "9876543210"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "OTP resent successfully",
  "data": {
    "mobile": "9876543210",
    "expiresIn": "15 minutes"
  }
}
```

---

### 4. Get Customer Profile
Get logged-in customer profile (Protected).

**Endpoint:** `GET /api/auth/mobile/profile`

**Headers:**
```
Authorization: Bearer <token>
```

**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "_id": "65a1b2c3d4e5f6a7b8c9d0e1",
    "phone": "9876543210",
    "name": "John Doe",
    "email": "john@example.com",
    "isVerified": true,
    "lastLogin": "2026-02-19T10:30:00.000Z",
    "createdAt": "2026-02-19T10:00:00.000Z",
    "updatedAt": "2026-02-19T10:30:00.000Z"
  }
}
```

---

### 5. Update Customer Profile
Update customer profile (Protected).

**Endpoint:** `PUT /api/auth/mobile/profile`

**Headers:**
```
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "name": "John Doe",
  "email": "john@example.com"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Profile updated successfully",
  "data": {
    "_id": "65a1b2c3d4e5f6a7b8c9d0e1",
    "phone": "9876543210",
    "name": "John Doe",
    "email": "john@example.com",
    "isVerified": true,
    "lastLogin": "2026-02-19T10:30:00.000Z",
    "createdAt": "2026-02-19T10:00:00.000Z",
    "updatedAt": "2026-02-19T10:45:00.000Z"
  }
}
```

---

### 6. Logout
Customer logout (Protected).

**Endpoint:** `POST /api/auth/mobile/logout`

**Headers:**
```
Authorization: Bearer <token>
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Logged out successfully"
}
```

---

## Configuration

### Environment Variables (.env)
```env
# JWT
JWT_SECRET=your_super_secret_jwt_key_here
JWT_EXPIRE=7d

# MongoDB
MONGODB_URI=mongodb://localhost:27017/logistics_db

# BulkSMS Configuration
BULKSMS_AUTH_KEY=3237656e63656738303394
BULKSMS_SENDER=CLGFOM
BULKSMS_ROUTE=2
BULKSMS_COUNTRY=0
BULKSMS_DLT_ID=1707176137809504396
```

---

## Features

1. **OTP Flow:**
   - 6-digit OTP generation
   - 15 minutes expiry
   - 3 maximum attempts
   - Resend OTP capability

2. **Auto Signup/Login:**
   - New customers are automatically created
   - Existing customers are logged in
   - Returns JWT token for authentication

3. **Security:**
   - OTPs are hashed and stored temporarily
   - JWT token-based authentication
   - Customer-only access middleware
   - Blocked customer prevention

4. **SMS Integration:**
   - Uses BulkSMS API
   - Customizable message template
   - DLT compliant

---

## Usage Flow

1. **New Customer:**
   ```
   POST /mobile/send-otp → POST /mobile/verify-otp → Get Token → Use Protected APIs
   ```

2. **Existing Customer:**
   ```
   POST /mobile/send-otp → POST /mobile/verify-otp → Get Token → Use Protected APIs
   ```

3. **Update Profile:**
   ```
   PUT /mobile/profile (with Authorization header)
   ```

---

## Files Created/Modified

- `backend/utils/smsService.js` - SMS sending utility
- `backend/models/OTP.js` - OTP model
- `backend/models/Customer.js` - Updated with auth methods
- `backend/controllers/mobileAuthController.js` - Mobile auth logic
- `backend/middleware/customerAuthMiddleware.js` - Customer protection
- `backend/routes/authRoutes.js` - Updated routes
- `backend/package.json` - Added axios dependency
- `backend/.env` - Added SMS config
