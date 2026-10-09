# GoDelivo Support & Complaint System API Reference

This document provides a comprehensive reference for all support-ticket and complaint-box endpoints implemented in GoDelivo backend.

---

## 1. Overview & Architecture

* **Base URL Prefix:** `/api/support`
* **Authentication Schemes:**
  * **Customer Auth:** JWT with `role: 'customer'`, header `Authorization: Bearer <token>`
  * **Driver Auth:** JWT with `type: 'driver_auth'`, header `Authorization: Bearer <token>`
  * **Admin Auth:** JWT with `role: 'admin' | 'super_admin'`, header `Authorization: Bearer <token>`
* **Ticket Types:**
  * `complaint`: Used for formal complaints regarding rides, driver/customer behavior, incorrect fares, damaged goods, or service issues.
  * `support_request`: Used for general help, inquiries, account queries, or technical assistance.
* **Security & Isolation:**
  * **Internal Notes (`isInternal: true`):** Visible **strictly to Admins**. Server-side serialization automatically strips internal notes and internal audit entries from customer/driver API responses.
  * **Ride Ownership:** Non-admins attempting to link a `relatedRideId` are validated against ride records (`customer.customerId` or `driver.driverId`).
  * **Financial Non-Interference:** Creating or viewing a complaint regarding fares, waiting charges, or wallets provides audit data but **never** mutates database balances automatically.

---

## 2. Status Lifecycle & Workflow

```
       ┌──────────┐
       │   open   │
       └────┬─────┘
            │
      ┌─────┴──────┐
      ▼            ▼
┌──────────┐ ┌─────────────┐
│ assigned │ │ in_progress │
└─────┬────┘ └──────┬──────┘
      │             │
      ├─────────────┼──────────────┐
      ▼             ▼              ▼
┌──────────────────┐ ┌──────────┐ ┌────────┐
│ waiting_for_user │ │ resolved │ │ closed │
└────────┬─────────┘ └────┬─────┘ └───┬────┘
         │                │ (reopen)  │ (reopen)
         └────────────────┴───────────┘
```

| Current Status | Allowed Target Statuses | Notes |
| :--- | :--- | :--- |
| `open` | `assigned`, `in_progress`, `closed` | Initial state upon creation |
| `assigned` | `in_progress`, `waiting_for_user`, `resolved`, `closed` | Admin assigned to ticket |
| `in_progress` | `waiting_for_user`, `resolved`, `closed`, `assigned` | Active investigation |
| `waiting_for_user` | `in_progress`, `resolved`, `closed` | Waiting for customer/driver reply |
| `resolved` | `closed`, `in_progress`, `open` | Solution provided; can reopen within 7 days |
| `closed` | `open`, `in_progress` | Archived/final state |

---

## 3. Endpoints Reference

### 3.1 Public & Configuration Endpoints

#### `GET /api/support/categories`
* **Description:** Retrieve available complaint and support categories for customers and drivers.
* **Auth:** Optional / Public
* **Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "ticketTypes": [
      { "id": "complaint", "label": "Complaint" },
      { "id": "support_request", "label": "Support Request" }
    ],
    "customerCategories": [
      { "id": "driver_behavior", "label": "Driver behavior", "type": "complaint", "rideRequired": true },
      { "id": "driver_not_arrived", "label": "Driver did not arrive", "type": "complaint", "rideRequired": true },
      { "id": "damaged_missing_goods", "label": "Damaged or missing goods", "type": "complaint", "rideRequired": true },
      { "id": "pickup_delivery_issue", "label": "Pickup or delivery issue", "type": "complaint", "rideRequired": true },
      { "id": "incorrect_fare", "label": "Incorrect ride fare", "type": "complaint", "rideRequired": true },
      { "id": "waiting_charges", "label": "Loading/unloading or waiting charges", "type": "complaint", "rideRequired": true },
      { "id": "payment_issue", "label": "Payment issue", "type": "complaint", "rideRequired": false },
      { "id": "cancellation_refund", "label": "Cancellation or refund", "type": "complaint", "rideRequired": false },
      { "id": "safety_concern", "label": "Safety concern", "type": "complaint", "rideRequired": false },
      { "id": "technical_issue", "label": "Technical issue", "type": "support_request", "rideRequired": false },
      { "id": "account_issue", "label": "Account & Profile", "type": "support_request", "rideRequired": false },
      { "id": "other", "label": "Other", "type": "support_request", "rideRequired": false }
    ],
    "driverCategories": [
      { "id": "customer_behavior", "label": "Customer behavior", "type": "complaint", "rideRequired": true },
      { "id": "pickup_drop_issue", "label": "Pickup or drop issue", "type": "complaint", "rideRequired": true },
      { "id": "waiting_charge_calc", "label": "Waiting-charge calculation", "type": "complaint", "rideRequired": true },
      { "id": "ride_fare_payment", "label": "Ride fare or payment", "type": "complaint", "rideRequired": true },
      { "id": "cash_settlement", "label": "Cash collection or settlement", "type": "complaint", "rideRequired": false },
      { "id": "wallet_earnings", "label": "Wallet and earnings", "type": "complaint", "rideRequired": false },
      { "id": "cancellation_dispute", "label": "Cancellation dispute", "type": "complaint", "rideRequired": true },
      { "id": "safety_concern", "label": "Safety concern", "type": "complaint", "rideRequired": false },
      { "id": "app_gps_issue", "label": "App or GPS issue", "type": "support_request", "rideRequired": false },
      { "id": "vehicle_verification", "label": "Vehicle / Document verification", "type": "support_request", "rideRequired": false },
      { "id": "other", "label": "Other", "type": "support_request", "rideRequired": false }
    ]
  }
}
```

#### `GET /api/support/config`
* **Description:** Retrieve full support system configuration, including SLA targets, attachment limits, and status transition matrix.
* **Auth:** Optional / Public

---

### 3.2 Customer & Driver Ticket Operations

#### `POST /api/support/tickets`
* **Description:** Create a new complaint or support request.
* **Auth:** Required (`customer`, `driver`, or `admin`)
* **Request Body:**
```json
{
  "type": "complaint",
  "category": "Loading/unloading or waiting charges",
  "subject": "Disputed ₹60 destination waiting charge",
  "description": "The driver reached the destination and we finished unloading in 15 minutes, but ₹60 was added.",
  "relatedRideId": "RID12345678",
  "priority": "Medium",
  "attachments": []
}
```
* **Response (201 Created):**
```json
{
  "success": true,
  "message": "Complaint submitted successfully with ID TKT-2610-0042",
  "data": {
    "ticketId": "TKT-2610-0042",
    "type": "complaint",
    "reporter": "651234567890abcdef123456",
    "reporterType": "CUSTOMER",
    "reporterName": "Rahul Sharma",
    "category": "Loading/unloading or waiting charges",
    "subject": "Disputed ₹60 destination waiting charge",
    "description": "The driver reached the destination and we finished unloading in 15 minutes, but ₹60 was added.",
    "relatedRideId": "651234567890abcdef123499",
    "relatedRideCode": "RID12345678",
    "status": "open",
    "priority": "Medium",
    "messages": [
      {
        "sender": "651234567890abcdef123456",
        "senderName": "Rahul Sharma",
        "senderType": "CUSTOMER",
        "message": "The driver reached the destination and we finished unloading in 15 minutes, but ₹60 was added.",
        "isInternal": false,
        "createdAt": "2026-10-09T13:20:00.000Z"
      }
    ],
    "createdAt": "2026-10-09T13:20:00.000Z"
  }
}
```

#### `GET /api/support/tickets/my`
* **Description:** Fetch paginated tickets created by the authenticated customer or driver.
* **Auth:** Required
* **Query Parameters:**
  * `page` (integer, default: 1)
  * `limit` (integer, default: 10)
  * `status` (string: `open`, `in_progress`, `resolved`, `closed`, `All`)
  * `type` (string: `complaint`, `support_request`, `All`)
  * `category` (string)
* **Response (200 OK):**
```json
{
  "success": true,
  "data": [
    {
      "ticketId": "TKT-2610-0042",
      "type": "complaint",
      "category": "Loading/unloading or waiting charges",
      "subject": "Disputed ₹60 destination waiting charge",
      "status": "in_progress",
      "priority": "Medium",
      "createdAt": "2026-10-09T13:20:00.000Z"
    }
  ],
  "pagination": {
    "total": 1,
    "page": 1,
    "pages": 1,
    "limit": 10
  }
}
```

#### `GET /api/support/tickets/:id`
* **Description:** Retrieve details for a specific ticket by `_id` or `ticketId`.
* **Auth:** Required (Non-admins can only view their own ticket; internal notes are automatically stripped).
* **Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "ticketId": "TKT-2610-0042",
    "type": "complaint",
    "reporter": "651234567890abcdef123456",
    "reporterType": "CUSTOMER",
    "status": "in_progress",
    "priority": "Medium",
    "subject": "Disputed ₹60 destination waiting charge",
    "description": "The driver reached the destination and we finished unloading in 15 minutes, but ₹60 was added.",
    "messages": [
      {
        "sender": "651234567890abcdef123456",
        "senderName": "Rahul Sharma",
        "senderType": "CUSTOMER",
        "message": "The driver reached the destination and we finished unloading in 15 minutes, but ₹60 was added.",
        "isInternal": false,
        "createdAt": "2026-10-09T13:20:00.000Z"
      },
      {
        "sender": "650000000000000000000001",
        "senderName": "Support Agent",
        "senderType": "ADMIN",
        "message": "Hello Rahul, we are reviewing the destination arrival timestamp and driver GPS coordinates.",
        "isInternal": false,
        "createdAt": "2026-10-09T13:25:00.000Z"
      }
    ]
  }
}
```

#### `POST /api/support/tickets/:id/messages`
* **Description:** Add a reply message to an active ticket.
* **Auth:** Required
* **Request Body:**
```json
{
  "message": "Here is additional context regarding the arrival time.",
  "attachments": []
}
```

#### `POST /api/support/tickets/:id/attachments`
* **Description:** Upload evidence file (image, PDF) and attach to ticket.
* **Auth:** Required
* **Content-Type:** `multipart/form-data` (`file`)

#### `POST /api/support/tickets/:id/close`
* **Description:** Close an open/resolved ticket.
* **Auth:** Required (Owner or Admin)
* **Request Body:** `{ "reason": "Issue resolved by driver" }`

#### `POST /api/support/tickets/:id/reopen`
* **Description:** Reopen a resolved/closed ticket within permitted reopen window.
* **Auth:** Required (Owner or Admin)
* **Request Body:** `{ "reason": "Issue recurring" }`

#### `PATCH /api/support/tickets/:id/read`
* **Description:** Mark incoming messages on ticket as read.

---

### 3.3 Admin & Support Agent APIs

#### `GET /api/support/admin/tickets` (or `GET /api/support/tickets`)
* **Description:** Administrative ticket list with full filtering, multi-field search, pagination, and system-wide KPI summary.
* **Auth:** Admin (`adminAuth`)
* **Query Parameters:** `status`, `priority`, `category`, `type`, `reporterType`, `assignedTo`, `search`, `relatedRideId`, `startDate`, `endDate`, `page`, `limit`.

#### `PUT /api/support/tickets/:id/status`
* **Description:** Advance or change ticket status with lifecycle validation and resolution notes.
* **Auth:** Admin
* **Request Body:**
```json
{
  "status": "resolved",
  "resolutionNotes": "GPS logs verified: 80 eligible waiting mins confirmed. ₹60 charge was correctly calculated according to vehicle waiting charge policy."
}
```

#### `PUT /api/support/tickets/:id/assign`
* **Description:** Assign ticket to a support agent.
* **Auth:** Admin
* **Request Body:** `{ "adminId": "650000000000000000000002" }`

#### `PUT /api/support/tickets/:id/priority`
* **Description:** Change priority (`Critical`, `High`, `Medium`, `Low`).
* **Auth:** Admin
* **Request Body:** `{ "priority": "Critical" }`

#### `POST /api/support/tickets/:id/admin-messages`
* **Description:** Send public reply or **Private Internal Note** (`isInternal: true`).
* **Auth:** Admin
* **Request Body:**
```json
{
  "message": "Checked waitingChargeCalculator logs: totalEligibleWaitingMinutes=80, chargeableMinutes=20, ratePerMinute=3.",
  "isInternal": true
}
```

#### `POST /api/support/tickets/:id/escalate`
* **Description:** Escalate ticket to Super Admin with priority escalation to `Critical`.
* **Auth:** Admin
* **Request Body:** `{ "reason": "Complex fare dispute requiring senior manager approval." }`

#### `GET /api/support/tickets/:id/related-ride`
* **Description:** Retrieve comprehensive related ride data, fare breakdown, waiting charge audit metadata, and payment records for review without financial modifications.
* **Auth:** Admin

#### `GET /api/support/admin/stats`
* **Description:** Global KPI metrics (total, open, inProgress, resolvedToday, byCategory, byType).
* **Auth:** Admin
