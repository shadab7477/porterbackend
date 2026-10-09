# GoDelivo MongoDB Database Schema & Models Documentation

This document describes all MongoDB models, subdocuments, data types, indexes, references, and validation rules in the GoDelivo backend.

---

## 1. Support & Complaint Models

### 1.1 `Ticket` Model (`models/Ticket.js`)

| Field | Type | Required | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `ticketId` | `String` | Yes (Unique) | `TKT-YYMM-XXXX` | Human-readable unique identifier |
| `type` | `String` | Yes | `'support_request'` | Enum: `['complaint', 'support_request']` |
| `reporter` | `ObjectId` | Yes | — | Dynamic reference based on `reporterModel` |
| `reporterModel`| `String` | Yes | `'Customer'` | Enum: `['Customer', 'Driver', 'Admin']` |
| `reporterName` | `String` | No | `'User'` | Name of reporter at creation time |
| `reporterType` | `String` | Yes | `'CUSTOMER'` | Enum: `['CUSTOMER', 'DRIVER', 'ADMIN']` |
| `reporterPhone`| `String` | No | `''` | Contact phone number |
| `reporterEmail`| `String` | No | `''` | Contact email |
| `category` | `String` | Yes | — | Complaint / Support category |
| `priority` | `String` | Yes | `'Medium'` | Enum: `['Critical', 'High', 'Medium', 'Low']` |
| `status` | `String` | Yes | `'open'` | Enum: `['open', 'assigned', 'in_progress', 'waiting_for_user', 'resolved', 'closed']` |
| `subject` | `String` | Yes | — | Ticket title / subject |
| `description` | `String` | Yes | — | Full issue description |
| `relatedRideId`| `ObjectId` | No | `null` | Reference to `Ride` |
| `relatedRideCode`|`String` | No | `''` | E.g. `'RID12345678'` |
| `assignedTo` | `ObjectId` | No | `null` | Reference to `Admin` |
| `assignedToName`|`String` | No | `null` | Admin name |
| `assignedAt` | `Date` | No | `null` | Assignment timestamp |
| `attachments` | `[Attachment]`| No | `[]` | Array of attachment objects |
| `messages` | `[Message]` | No | `[]` | Public messages & private internal notes |
| `resolutionNotes`|`String` | No | `''` | Summary of resolution provided |
| `resolvedAt` | `Date` | No | `null` | Timestamp when marked resolved |
| `resolvedBy` | `ObjectId` | No | `null` | Admin who resolved the ticket |
| `closedAt` | `Date` | No | `null` | Timestamp when closed |
| `closedBy` | `ObjectId` | No | `null` | User or Admin who closed |
| `reopenedAt` | `Date` | No | `null` | Timestamp when reopened |
| `reopenedBy` | `ObjectId` | No | `null` | User or Admin who reopened |
| `reopenReason` | `String` | No | `''` | Reason for reopening |
| `lastMessageAt`| `Date` | No | `Date.now` | Timestamp of latest message |
| `auditHistory` | `[AuditEntry]`| No | `[]` | Immutable timeline of all lifecycle events |
| `createdAt` | `Date` | Yes | `Date.now` | Creation timestamp |
| `updatedAt` | `Date` | Yes | `Date.now` | Last update timestamp |

**Indexes:**
* `{ ticketId: 1 }` (Unique)
* `{ reporter: 1, reporterType: 1, createdAt: -1 }`
* `{ status: 1, priority: 1, createdAt: -1 }`
* `{ category: 1, type: 1 }`
* `{ relatedRideId: 1 }`
* `{ assignedTo: 1 }`

---

## 2. Core User & Entity Models

### 2.1 `Customer` Model (`models/Customer.js`)
* `name` (String, trim)
* `phone` (String, required, unique, indexed)
* `email` (String, trim, lowercase)
* `fcmToken` (String)
* `savedAddresses` (Array of subdocuments with `tag`, `address`, `lat`, `lng`)
* `bankDetails` (`{ accountHolderName, accountNumber, ifscCode, bankName, branchName }`)
* `isBlocked` (Boolean, default: `false`)
* `isVerified` (Boolean, default: `false`)
* `isMerchant` (Boolean, default: `false`)
* `merchantDiscount` (Number, default: `5`)
* `merchantApplicationId` (ObjectId, ref: `'MerchantApplication'`)

### 2.2 `Driver` Model (`models/Driver.js`)
* `driverId` (String, unique, sparse)
* `name` (String, required)
* `phone` (String, required, unique, indexed)
* `email` (String)
* `applicationId` (ObjectId, ref: `'DriverApplication'`, required)
* `vehicleType` (String, required: `bike`, `auto`, `tata_ace`, etc.)
* `vehicleNumber` (String, required, unique)
* `isOnline` (Boolean, default: `false`)
* `isAvailable` (Boolean, default: `true`)
* `currentLocation` (Point 2dsphere: `[lng, lat]`)
* `isBlocked` (Boolean, default: `false`)
* `totalEarnings` (Number, default: `0`)
* `totalTrips` (Number, default: `0`)
* `rating` (Number, 0–5)
* `subscription` (`{ status, amount, validUntil }`)

### 2.3 `Admin` Model (`models/Admin.js`)
* `username` (String, unique, required)
* `password` (String, required)
* `role` (String, enum: `['admin', 'super_admin']`, default: `'super_admin'`)
* `name` (String)
* `email` (String)
* `lastLogin` (Date)

---

## 3. Ride & Financial Models

### 3.1 `Ride` Model (`models/Ride.js`)
* `rideId` (String, unique)
* `requestedVehicleType` (String)
* `customer` (`{ customerId, name, phone, rating }`)
* `driver` (`{ driverId, name, phone, vehicleType, vehicleNumber, rating }`)
* `pickupLocation` & `dropLocation` (Point coordinates + address)
* `dropLocations` (Array of multi-drop locations)
* `distance` (Number, km), `duration` (Number, minutes)
* `status` (`'requested'`, `'searching'`, `'driver_assigned'`, `'driver_arrived'`, `'in_progress'`, `'completed'`, `'cancelled'`, `'no_drivers'`)
* `fare`:
  * `baseFareAmount` (Number)
  * `pickupWaitingCharge` (Number)
  * `destinationWaitingCharge` (Number)
  * `totalWaitingCharge` (Number)
  * `platformFee` (Number, default: `1`)
  * `finalAmount` (Number)
* `platformFeeDetails`:
  * `amount` (Number, default: `1`)
  * `currency` (String, default: `'INR'`)
  * `feeType` (String: `'platform_fee'`)
  * `calculationType` (String: `'fixed_per_billable_ride'`)
  * `reason` (String: `'Fixed GoDelivo platform fee'`)
  * `charged` (Boolean: `true`)
  * `calculationVersion` (Number: `1`)
  * `calculatedAt` (Date)
  * `driverWalletCredit` (Number: `0`)
  * `settlementType` (String: `'customer_fare_platform_component'`)
* `waitingChargeDetails`:
  * `vehicleType` (String)
  * `freeMinutes` (Number)
  * `ratePerMinute` (Number)
  * `pickupWaitingMinutes` (Number)
  * `destinationWaitingMinutes` (Number)
  * `totalEligibleWaitingMinutes` (Number)
  * `chargeableMinutes` (Number)
  * `chargeAmount` (Number)
  * `calculationReason` (String)
  * `chargeSource` (`['pickup', 'destination']`)
  * `travelingTimeExcluded` (Boolean: `true`)
  * `driverWalletCredit` (Number: `0`)
* `driverArrivedAt` (Date), `pickupDepartureAt` (Date), `destinationArrivedAt` (Date), `rideStartedAt` (Date), `completedAt` (Date)

### 3.2 `CustomerWallet` & `DriverWallet` Models
* `CustomerWallet`: `{ customerId, balance, transactions: [...] }`
* `DriverWallet`: `{ driverId, balance, todayCollection, weeklyCollection, totalCollection, transactions: [...] }`
* `CustomerWithdrawalRequest`: `{ customerId, amount, status: ['pending', 'approved', 'rejected', 'paid'], bankDetails }`

### 3.3 `Payment` Model (`models/Payment.js`)
* `orderId` (String), `rideId` (String), `customerId` (ObjectId), `driverId` (ObjectId)
* `amount` (Number), `currency` (`'INR'`)
* `status` (`'created'`, `'authorized'`, `'captured'`, `'refunded'`, `'failed'`)
* `paymentMethod` (`'card'`, `'upi'`, `'netbanking'`, `'wallet'`, `'cash'`)
* `razorpayPaymentId`, `razorpayOrderId`, `razorpaySignature`

---

## 4. Other Modules & Models

* `MerchantApplication`: Store merchant verification documents, status (`pending`, `verified`, `rejected`), discount configs.
* `PackerBooking`: Movers & packers booking requests with items list, quote amount, deposit, assigned drivers.
* `ShiftingRequest`: House shifting inquiries with room counts, origin, destination.
* `ChatMessage`: Real-time chat messages linked to active `rideId`.
* `FAQ`: Categorized public FAQs (`category`, `question`, `answer`, `isActive`).
* `GoodsItem` & `RestrictedItem`: Goods categorization and prohibited material definitions.
* `Vehicle` & `VehiclePricing`: Vehicle capacity rules, base fares, per-km rates, night charges.
