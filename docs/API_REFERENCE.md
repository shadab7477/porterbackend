# GoDelivo Complete Backend API Reference Manual

This document provides an exhaustive, production-grade inventory of every HTTP endpoint registered in the GoDelivo backend application, including parameters, authentication requirements, roles, payload schemas, response structures, status codes, and side effects.

---

## Table of Contents

1. [Authentication & Mobile OTP (`/api/auth`)](#1-authentication--mobile-otp-apiauth)
2. [Driver Onboarding & Authentication (`/api/driver`)](#2-driver-onboarding--authentication-apidriver)
3. [Customer Profile & Management (`/api/customers`)](#3-customer-profile--management-apicustomers)
4. [Driver Fleet Management (`/api/drivers`)](#4-driver-fleet-management-apidrivers)
5. [Rides, Fares & Real-Time Tracking (`/api/rides`)](#5-rides-fares--real-time-tracking-apirides)
6. [Orders Management (`/api/orders`)](#6-orders-management-apiorders)
7. [Payments & Gateway Webhooks (`/api/payments`)](#7-payments--gateway-webhooks-apipayments)
8. [Wallets, Earnings & Driver Settlements (`/api/wallet`)](#8-wallets-earnings--driver-settlements-apiwallet)
9. [Support & Complaint System (`/api/support`)](#9-support--complaint-system-apisupport)
10. [Customer Withdrawals (`/api/withdrawals`)](#10-customer-withdrawals-apiwithdrawals)
11. [Merchant Partner Program (`/api/merchant`)](#11-merchant-partner-program-apimerchant)
12. [Packers & Movers (`/api/packers-movers`)](#12-packers--movers-apipackers-movers)
13. [Shifting Inquiries (`/api/shifting`)](#13-shifting-inquiries-apishifting)
14. [Vehicles & Pricing Catalog (`/api/vehicles`, `/api/admin/pricing`)](#14-vehicles--pricing-catalog-apivehicles)
15. [Driver Verification System (`/api/verification`)](#15-driver-verification-system-apiverification)
16. [Push Notifications (`/api/notifications`, `/api/admin/notifications`)](#16-push-notifications-apinotifications)
17. [In-Ride Chat (`/api/chat`)](#17-in-ride-chat-apichat)
18. [Frequently Asked Questions (`/api/faq`)](#18-frequently-asked-questions-apifaq)
19. [Admin Inventory Items (`/api/admin/restricted-items`, `/api/admin/goods-items`)](#19-admin-inventory-items)
20. [Admin Analytics Dashboard (`/api/admin/dashboard`)](#20-admin-analytics-dashboard-apiadmindashboard)
21. [System & Health Checks (`/health`, `/socket-test`)](#21-system--health-checks)

---

## 1. Authentication & Mobile OTP (`/api/auth`)

### `POST /api/auth/login`
* **Purpose:** Admin login with fixed/database credentials.
* **Auth:** Public
* **Body:** `{ "username": "admin", "password": "password123" }`
* **Response (200):** `{ "success": true, "token": "...", "admin": { "id": "...", "username": "admin", "role": "super_admin" } }`

### `GET /api/auth/me`
* **Purpose:** Fetch logged-in admin profile.
* **Auth:** Required (`admin`)
* **Response (200):** `{ "success": true, "admin": { "id": "...", "username": "admin", "email": "..." } }`

### `POST /api/auth/logout`
* **Purpose:** Invalidate admin session.
* **Auth:** Required (`admin`)

### `POST /api/auth/mobile/send-otp`
* **Purpose:** Generate and send 6-digit SMS OTP to customer phone.
* **Auth:** Public
* **Body:** `{ "phone": "9876543210" }`
* **Response (200):** `{ "success": true, "message": "OTP sent successfully" }`

### `POST /api/auth/mobile/verify-otp`
* **Purpose:** Verify OTP and return customer JWT auth token.
* **Auth:** Public
* **Body:** `{ "phone": "9876543210", "otp": "123456" }`
* **Response (200):** `{ "success": true, "token": "...", "customer": { "id": "...", "phone": "...", "isVerified": true } }`

### `POST /api/auth/mobile/resend-otp`
* **Purpose:** Resend OTP to customer.
* **Auth:** Public
* **Body:** `{ "phone": "9876543210" }`

### `GET /api/auth/mobile/profile`
* **Purpose:** Get authenticated customer profile & saved addresses.
* **Auth:** Required (`customer`)

### `PUT /api/auth/mobile/profile`
* **Purpose:** Update customer name, email, saved addresses.
* **Auth:** Required (`customer`)
* **Body:** `{ "name": "Rahul", "email": "rahul@example.com", "savedAddresses": [...] }`

### `POST /api/auth/mobile/logout`
* **Purpose:** Customer logout and clear FCM push token.
* **Auth:** Required (`customer`)

---

## 2. Driver Onboarding & Authentication (`/api/driver`)

### `POST /api/driver/send-otp`
* **Purpose:** Send OTP for driver authentication/registration.
* **Auth:** Public
* **Body:** `{ "phone": "9876543210" }`

### `POST /api/driver/verify-otp`
* **Purpose:** Verify driver OTP. Returns auth token with `type: 'driver_auth'`.
* **Auth:** Public
* **Body:** `{ "phone": "9876543210", "otp": "123456" }`

### `GET /api/driver/status/:phone`
* **Purpose:** Public status check of a driver's application.
* **Auth:** Public
* **Response (200):** `{ "success": true, "application": { "status": "pending_verification" | "verified" | "rejected" } }`

### `POST /api/driver/login`
* **Purpose:** Driver login.
* **Auth:** Public

### `POST /api/driver/register`
* **Purpose:** Complete driver KYC document upload (Multipart form data).
* **Auth:** Required (`driver_auth`)
* **Form Fields:** `fullName`, `vehicleType`, `vehicleNumber`, `city`, `profilePhoto`, `aadharFront`, `aadharBack`, `panCard`, `drivingLicense`, `vehicleRC`, `vehiclePhoto`.

### `GET /api/driver/profile`
* **Purpose:** Retrieve verified driver profile, earnings, ratings, and subscription status.
* **Auth:** Required (`driver`)

### `POST /api/driver/toggle-online`
* **Purpose:** Toggle driver online/offline availability.
* **Auth:** Required (`driver`)
* **Body:** `{ "isOnline": true }`

### `GET /api/driver/online-status`
* **Purpose:** Get current online/available state.
* **Auth:** Required (`driver`)

### `POST /api/driver/location`
* **Purpose:** Update driver's GPS coordinates (`[lng, lat]`).
* **Auth:** Required (`driver`)
* **Body:** `{ "latitude": 28.6139, "longitude": 77.2090 }`

### `GET /api/driver/stats`
* **Purpose:** Get driver trip statistics and earnings overview.
* **Auth:** Required (`driver`)

### `GET /api/driver/subscription/fee`
* **Purpose:** Get subscription pricing for vehicle types.
* **Auth:** Public

### `POST /api/driver/subscription/create-order`
* **Purpose:** Create Razorpay subscription payment order.
* **Auth:** Required (`driver`)

### `POST /api/driver/subscription/verify`
* **Purpose:** Verify Razorpay signature and activate driver subscription.
* **Auth:** Required (`driver`)

---

## 3. Customer Profile & Management (`/api/customers`)

* `GET /api/customers/stats` (Admin) — Customer count, active customers, registration trends.
* `GET /api/customers/search/:phone` (Admin) — Search customer by phone.
* `GET /api/customers/` (Admin) — Paginated list of all customers.
* `GET /api/customers/:id` (Admin) — Customer details & ride history.
* `POST /api/customers/` (Admin) — Create customer record.
* `PUT /api/customers/:id` (Admin) — Update customer details.
* `DELETE /api/customers/:id` (Admin) — Delete customer.
* `PATCH /api/customers/:id/toggle-block` (Admin) — Block/unblock customer account.

---

## 4. Driver Fleet Management (`/api/drivers`)

* `GET /api/drivers/` (Admin) — List all drivers with filtering by vehicle type, verification status, online status.
* `GET /api/drivers/available` (Admin) — List available online drivers.
* `GET /api/drivers/pending-verification` (Admin) — List drivers waiting for KYC review.
* `GET /api/drivers/:id` (Admin) — Get driver details with uploaded documents.
* `GET /api/drivers/:id/rides` (Admin) — Get driver ride history.
* `GET /api/drivers/:id/transactions` (Admin) — Get driver wallet transaction history.
* `POST /api/drivers/:id/wallet-adjust` (Admin) — Manual wallet balance adjustment.
* `POST /api/drivers/:id/verify` (Admin) — Approve driver application.
* `POST /api/drivers/:id/reject` (Admin) — Reject driver application with reason.
* `PATCH /api/drivers/:id/toggle-block` (Admin) — Block/unblock driver.
* `PATCH /api/drivers/:id/active` (Admin) — Toggle driver active status.

---

## 5. Rides, Fares & Real-Time Tracking (`/api/rides`)

### `GET /api/rides/nearby-drivers`
* **Auth:** Public
* **Query:** `lat`, `lng`, `vehicleType`, `radius`
* **Response:** Nearby drivers within geofence.

### `GET /api/rides/fare-estimate`
* **Auth:** Public
* **Query:** `pickupLat`, `pickupLng`, `dropLat`, `dropLng`, `vehicleType`
* **Response:** Estimated fare, distance, duration, and fare breakdown including `platformFee: 1` and `platformFeeDetails`.
* **Example Response:**
  ```json
  {
    "success": true,
    "distance": 12.5,
    "duration": 25,
    "estimatedFare": 351,
    "breakdown": {
      "baseFare": 350,
      "platformFee": 1,
      "totalWaitingCharge": 0,
      "finalFare": 351,
      "currency": "INR"
    },
    "platformFeeDetails": {
      "amount": 1,
      "currency": "INR",
      "feeType": "platform_fee",
      "calculationType": "fixed_per_billable_ride",
      "reason": "Fixed GoDelivo platform fee",
      "charged": true,
      "calculationVersion": 1
    }
  }
  ```

### `POST /api/rides/request`
* **Purpose:** Customer requests a new ride/delivery.
* **Auth:** Required (`customer`)
* **Body:** `{ "pickupLocation": {...}, "dropLocation": {...}, "vehicleType": "tata_ace", "receiver": {...} }`
* **Response (201):** Returns created ride object containing `fare.platformFee: 1`, `fare.finalAmount`, and `platformFeeDetails`.

### `POST /api/rides/accept`
* **Purpose:** Driver accepts ride dispatch.
* **Auth:** Required (`driver`)
* **Body:** `{ "rideId": "RID123456" }`

### `POST /api/rides/reject`
* **Purpose:** Driver declines ride request.
* **Auth:** Required (`driver`)

### `POST /api/rides/arrived`
* **Purpose:** Driver arrives at pickup location. Starts pickup waiting timer (`driverArrivedAt`).
* **Auth:** Required (`driver`)

### `POST /api/rides/arrived-destination`
* **Purpose:** Driver arrives at destination. Starts destination waiting timer (`destinationArrivedAt`).
* **Auth:** Required (`driver`)

### `POST /api/rides/start`
* **Purpose:** Driver departs pickup. Freezes pickup waiting timer (`pickupDepartureAt`), starts trip travel.
* **Auth:** Required (`driver`)

### `POST /api/rides/complete`
* **Purpose:** Driver completes delivery. Freezes destination waiting timer, calculates final fare including waiting charges and ₹1 platform fee, and settles driver earnings.
* **Auth:** Required (`driver`)
* **Fare Calculation Formula:** `finalFare = baseFare + totalWaitingCharge + platformFee (1 INR)`
* **Settlement Behavior:** Customer pays `finalFare`. Platform fee is retained by the platform (driver wallet credit is ₹0, driver payout is strictly 85% of base fare).
* **Response (200):**
  ```json
  {
    "success": true,
    "message": "Ride completed successfully",
    "ride": {
      "rideId": "RID123456",
      "fare": {
        "baseFareAmount": 350,
        "pickupWaitingCharge": 0,
        "destinationWaitingCharge": 60,
        "totalWaitingCharge": 60,
        "platformFee": 1,
        "finalAmount": 411
      },
      "platformFeeDetails": {
        "amount": 1,
        "currency": "INR",
        "feeType": "platform_fee",
        "calculationType": "fixed_per_billable_ride",
        "reason": "Fixed GoDelivo platform fee",
        "charged": true,
        "calculationVersion": 1,
        "driverWalletCredit": 0,
        "settlementType": "customer_fare_platform_component"
      }
    }
  }
  ```

### `POST /api/rides/:rideId/cancel`
* **Purpose:** Cancel active ride with cancellation validation middleware.
* **Auth:** Required (`customer` | `driver` | `admin`)

### `GET /api/rides/:rideId/track`
* **Purpose:** Real-time tracking data including driver location, timestamps, route progress, and full fare breakdown.
* **Auth:** Required (`customer`)

### `GET /api/rides/`
* **Purpose:** Admin list of all rides with tab filters (`active`, `completed`, `cancelled`), date ranges, and fare filters.
* **Auth:** Admin

---

## 6. Payments & Gateway Webhooks (`/api/payments`)

* `POST /api/payments/create-order` (Customer) — Create Razorpay order for ride fare.
* `POST /api/payments/verify` (Customer) — Verify Razorpay signature.
* `POST /api/payments/wallet/pay` (Customer) — Instant deduction from customer wallet.
* `GET /api/payments/history` (Customer) — Customer transaction history.
* `GET /api/payments/:rideId/status` (Customer) — Check payment status for a ride.
* `POST /api/payments/receiver/create-order` (Driver) — Driver generates QR/payment order for receiver at drop location.
* `POST /api/payments/receiver/verify` (Driver) — Driver verifies receiver payment.
* `POST /api/payments/webhook/razorpay` (Public) — Gateway webhook for asynchronous payment capture.
* `GET /api/payments/admin/history` (Admin) — All payment transactions.

---

## 7. Wallets, Earnings & Driver Settlements (`/api/wallet`)

* `GET /api/wallet/customer/balance` (Customer) — Customer wallet balance.
* `POST /api/wallet/customer/create-order` (Customer) — Add money to wallet.
* `POST /api/wallet/customer/verify` (Customer) — Verify wallet top-up.
* `POST /api/wallet/customer/withdraw` (Customer) — Request wallet balance withdrawal to bank.
* `GET /api/wallet/driver/balance` (Driver) — Driver wallet balance & daily/weekly collections.
* `POST /api/wallet/driver/withdraw` (Driver) — Driver withdrawal request.
* `GET /api/wallet/admin/withdrawals` (Admin) — List pending withdrawal requests.
* `POST /api/wallet/admin/withdrawals/:id/approve` (Admin) — Approve withdrawal.
* `POST /api/wallet/admin/withdrawals/:id/reject` (Admin) — Reject withdrawal.

---

## 8. Support & Complaint System (`/api/support`)

* `GET /api/support/categories` (Public/Auth) — Configured complaint & support categories.
* `GET /api/support/config` (Public/Auth) — Full support system rules, SLA and transitions.
* `POST /api/support/tickets` (Auth) — Submit new complaint or support request.
* `GET /api/support/tickets/my` (Auth) — List authenticated user's tickets.
* `GET /api/support/tickets/:id` (Auth) — Get ticket details (Internal notes stripped for non-admins).
* `POST /api/support/tickets/:id/messages` (Auth) — Send reply message.
* `POST /api/support/tickets/:id/attachments` (Auth) — Upload evidence file.
* `PATCH /api/support/tickets/:id/read` (Auth) — Mark messages as read.
* `POST /api/support/tickets/:id/close` (Auth) — Close ticket.
* `POST /api/support/tickets/:id/reopen` (Auth) — Reopen ticket.
* `GET /api/support/admin/tickets` (Admin) — Filtered administrative ticket inventory.
* `GET /api/support/admin/stats` (Admin) — Support KPI metrics.
* `GET /api/support/unassigned` (Admin) — Unassigned tickets queue.
* `GET /api/support/my-tickets` (Admin) — Tickets assigned to logged-in admin.
* `PUT /api/support/tickets/:id/status` (Admin) — Status transition with validation.
* `PUT /api/support/tickets/:id/assign` (Admin) — Assign ticket to support agent.
* `PUT /api/support/tickets/:id/priority` (Admin) — Update priority.
* `POST /api/support/tickets/:id/admin-messages` (Admin) — Add public reply or private internal note (`isInternal: true`).
* `POST /api/support/tickets/:id/escalate` (Admin) — Escalate to Super Admin.
* `GET /api/support/tickets/:id/related-ride` (Admin) — View complete related ride fare breakdown, waiting charge calculation, and payment records without financial mutation.

---

## 9. Customer Withdrawals (`/api/withdrawals`)

* `POST /api/withdrawals/request` (Customer) — Submit withdrawal request.
* `GET /api/withdrawals/my-requests` (Customer) — View my withdrawal requests.
* `POST /api/withdrawals/:id/cancel` (Customer) — Cancel pending withdrawal request.
* `GET /api/withdrawals/admin/stats` (Admin) — Withdrawal stats.
* `GET /api/withdrawals/admin/all` (Admin) — All withdrawal requests.
* `GET /api/withdrawals/admin/:id` (Admin) — Single withdrawal request.
* `PUT /api/withdrawals/admin/:id/approve` (Admin) — Approve request.
* `PUT /api/withdrawals/admin/:id/mark-paid` (Admin) — Mark withdrawal as paid.
* `PUT /api/withdrawals/admin/:id/reject` (Admin) — Reject withdrawal.

---

## 10. Merchant Partner Program (`/api/merchant`)

* `POST /api/merchant/apply` (Customer) — Submit merchant application with KYC files.
* `GET /api/merchant/status` (Customer) — Merchant application status.
* `PATCH /api/merchant/toggle-status` (Customer) — Toggle merchant booking mode.
* `GET /api/merchant/bank-details` (Customer) — Bank details for merchant payouts.
* `PUT /api/merchant/bank-details` (Customer) — Update merchant bank details.
* `GET /api/merchant/admin/applications` (Admin) — List all merchant applications.
* `GET /api/merchant/admin/applications/:id` (Admin) — Single merchant application details.
* `PUT /api/merchant/admin/applications/:id/documents/:docType/verify` (Admin) — Verify document.
* `PUT /api/merchant/admin/applications/:id/approve` (Admin) — Approve merchant application.
* `PUT /api/merchant/admin/applications/:id/reject` (Admin) — Reject merchant application.
* `GET /api/merchant/admin/settings` (Admin) — Get merchant discount & markup configs.
* `PUT /api/merchant/admin/settings` (Admin) — Update merchant settings.

---

## 11. Packers & Movers (`/api/packers-movers`)

* `POST /api/packers-movers/book` (Customer) — Create packing & moving booking request.
* `POST /api/packers-movers/:id/payment-webhook` (Public) — Deposit confirmation.
* `GET /api/packers-movers/admin/pending` (Admin) — List pending packer bookings.
* `PATCH /api/packers-movers/admin/:id/assign` (Admin) — Assign drivers/packers.
* `PATCH /api/packers-movers/:id/status` (Admin) — Update booking status.

---

## 12. Shifting Inquiries (`/api/shifting`)

* `POST /api/shifting/` (Public) — Customer inquiry for house/office shifting.
* `GET /api/shifting/` (Admin) — List all shifting requests.
* `PATCH /api/shifting/:id/status` (Admin) — Update request status.
* `DELETE /api/shifting/:id` (Admin) — Delete shifting request.

---

## 13. Vehicles & Pricing (`/api/vehicles`, `/api/admin/pricing`)

* `GET /api/vehicles/` (Public/Auth) — List vehicle types with pricing models.
* `GET /api/vehicles/active` (Public/Auth) — List active vehicle types.
* `GET /api/vehicles/:id` (Public/Auth) — Vehicle details.
### `POST /api/vehicles/calculate-fare`
* **Purpose:** Dynamic multi-vehicle fare calculation based on distance, duration, goods type, and vehicle rates. Adds ₹1 platform fee to total quote.
* **Auth:** Public / Auth
* **Body:**
  ```json
  {
    "pickup": { "lat": 28.6139, "lng": 77.2090 },
    "dropoff": { "lat": 28.7041, "lng": 77.1025 },
    "distance": 15.2,
    "duration": 35,
    "goodsType": "general"
  }
  ```
* **Response (200):**
  ```json
  {
    "success": true,
    "distance": 15.2,
    "duration": 35,
    "breakdown": {
      "distanceFare": 350,
      "timeFare": 0,
      "waitingCharge": 0,
      "platformFee": 1,
      "subtotal": 351,
      "tax": 0,
      "total": 351,
      "currency": "INR"
    },
    "platformFeeDetails": {
      "amount": 1,
      "currency": "INR",
      "feeType": "platform_fee",
      "calculationType": "fixed_per_billable_ride",
      "reason": "Fixed GoDelivo platform fee",
      "charged": true,
      "calculationVersion": 1
    },
    "vehicleOptions": [
      {
        "vehicleType": "bike",
        "fare": 151,
        "platformFee": 1
      },
      {
        "vehicleType": "tata_ace",
        "fare": 351,
        "platformFee": 1
      }
    ]
  }
  ```

* `POST /api/vehicles/` (Admin) — Create vehicle type.
* `PUT /api/vehicles/:id` (Admin) — Update vehicle specs.
* `DELETE /api/vehicles/:id` (Admin) — Delete vehicle type.
* `POST /api/vehicles/:id/image/:index` (Admin) — Upload vehicle image.
* `DELETE /api/vehicles/:id/image/:index` (Admin) — Delete vehicle image.
* `GET /api/admin/pricing/categories` (Admin) — Goods categories.
* `POST /api/admin/pricing/category` (Admin) — Create category.
* `GET /api/admin/pricing/pricing-rules` (Admin) — View pricing rules.
* `POST /api/admin/pricing/pricing-rule` (Admin) — Create/update pricing rule.

---

## 14. Driver Verification (`/api/verification`)

* `GET /api/verification/stats` (Admin) — Document verification statistics.
* `GET /api/verification/applications` (Admin) — List driver verification applications.
* `GET /api/verification/applications/:id` (Admin) — Application detail.
* `PUT /api/verification/applications/:id/verify` (Admin) — Verify application.
* `PUT /api/verification/applications/:id/reject` (Admin) — Reject application.
* `PUT /api/verification/applications/:id/documents/:documentType/verify` (Admin) — Verify individual document (e.g. `drivingLicense`, `aadharFront`).

---

## 15. In-Ride Chat & Notifications (`/api/chat`, `/api/notifications`)

* `POST /api/chat/message` (Customer/Driver) — Send in-ride chat message.
* `GET /api/chat/history/:rideId` (Customer/Driver) — Chat message history for a ride.
* `POST /api/notifications/test` (Public) — Send test FCM push notification.
* `POST /api/admin/notifications/send` (Admin) — Broadcast push notification with optional image banner.
* `GET /api/admin/notifications/history` (Admin) — Notification send history.
* `PUT /api/admin/notifications/:id/read` (Admin) — Mark notification as read.

---

## 16. FAQs & Admin Inventory

* `GET /api/faq/public` (Public) — Published FAQs.
* `GET /api/faq/` (Admin) — All FAQs.
* `POST /api/faq/` (Admin) — Create FAQ.
* `PUT /api/faq/:id` (Admin) — Update FAQ.
* `DELETE /api/faq/:id` (Admin) — Delete FAQ.
* `POST /api/admin/restricted-items/upload` (Admin) — Bulk upload restricted items (CSV/JSON).
* `GET /api/admin/restricted-items` (Admin) — List restricted items.
* `DELETE /api/admin/restricted-items/:id` (Admin) — Delete restricted item.
* `POST /api/admin/goods-items/upload` (Admin) — Bulk upload goods catalog.
* `GET /api/admin/goods-items` (Admin) — List goods items.
* `PATCH /api/admin/goods-items/:id/status` (Admin) — Update goods status.
* `DELETE /api/admin/goods-items/:id` (Admin) — Delete goods item.
* `GET /api/admin/dashboard/stats` (Admin) — Global dashboard analytics summary.

---

## 17. System Health & Diagnostics

* `GET /health` (Public) — Service health status, uptime, MongoDB connectivity, and active driver/customer/ride counts.
* `GET /socket-test` (Public) — Socket.IO connectivity test and connection count.
