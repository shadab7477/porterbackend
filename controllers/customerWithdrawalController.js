// controllers/customerWithdrawalController.js
import CustomerWithdrawalRequest from '../models/CustomerWithdrawalRequest.js';
import Customer from '../models/Customer.js';
import CustomerWallet from '../models/CustomerWallet.js';
import CustomerWalletTransaction from '../models/CustomerWalletTransaction.js';

const MIN_WITHDRAWAL = 500;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const getOrCreateWallet = async (customerId) => {
  let wallet = await CustomerWallet.findOne({ customerId });
  if (!wallet) wallet = await CustomerWallet.create({ customerId, balance: 0 });
  return wallet;
};

// ─── CUSTOMER: Request a withdrawal ───────────────────────────────────────────
// POST /api/withdrawals/request
export const createWithdrawalRequest = async (req, res) => {
  try {
    const customerId = req.customerId;
    const { amount } = req.body;

    // Validate amount
    const parsedAmount = parseFloat(amount);
    if (!parsedAmount || isNaN(parsedAmount) || parsedAmount < MIN_WITHDRAWAL) {
      return res.status(400).json({
        success: false,
        message: `Minimum withdrawal amount is ₹${MIN_WITHDRAWAL}`
      });
    }

    // Fetch customer
    const customer = await Customer.findById(customerId);
    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    // Check bank details
    const bd = customer.bankDetails;
    if (!bd || !bd.accountHolderName || !bd.accountNumber || !bd.ifscCode) {
      return res.status(400).json({
        success: false,
        message: 'Please add your bank account details before requesting a withdrawal.'
      });
    }

    // Check wallet balance
    const wallet = await getOrCreateWallet(customerId);
    if (wallet.balance < parsedAmount) {
      return res.status(400).json({
        success: false,
        message: `Insufficient wallet balance. Available: ₹${wallet.balance.toFixed(2)}, Requested: ₹${parsedAmount}`,
        walletBalance: wallet.balance,
        requested: parsedAmount
      });
    }

    // Block if a pending request already exists
    const existingPending = await CustomerWithdrawalRequest.findOne({
      customerId,
      status: { $in: ['pending', 'approved'] }
    });
    if (existingPending) {
      return res.status(400).json({
        success: false,
        message: 'You already have a pending withdrawal request. Please wait for it to be processed.',
        existingRequestId: existingPending._id,
        existingStatus: existingPending.status
      });
    }

    // Deduct from wallet immediately (hold amount)
    const prevBalance = wallet.balance;
    wallet.balance -= parsedAmount;
    await wallet.save();

    // Create debit transaction
    const txn = await CustomerWalletTransaction.create({
      customerId,
      amount: parsedAmount,
      type: 'debit',
      transactionCategory: 'withdrawal',
      description: `Withdrawal request of ₹${parsedAmount}`,
      previousBalance: prevBalance,
      newBalance: wallet.balance,
      status: 'pending'
    });

    // Create withdrawal request
    const request = await CustomerWithdrawalRequest.create({
      customerId,
      customerPhone: customer.phone,
      customerName: customer.name || '',
      amount: parsedAmount,
      bankDetails: {
        accountHolderName: bd.accountHolderName,
        accountNumber: bd.accountNumber,
        ifscCode: bd.ifscCode,
        bankName: bd.bankName || '',
        branchName: bd.branchName || ''
      },
      walletTransactionId: txn._id,
      walletBalanceAtRequest: prevBalance,
      status: 'pending'
    });

    // Update txn with request ref
    txn.description = `Withdrawal request #${request._id} of ₹${parsedAmount}`;
    await txn.save();

    res.status(201).json({
      success: true,
      message: `Withdrawal request of ₹${parsedAmount} submitted. Amount has been held from your wallet and will be transferred within 2-3 business days.`,
      data: {
        requestId: request._id,
        amount: parsedAmount,
        status: request.status,
        walletBalance: wallet.balance,
        bankDetails: {
          accountHolderName: bd.accountHolderName,
          accountNumber: `****${bd.accountNumber.slice(-4)}`,
          ifscCode: bd.ifscCode,
          bankName: bd.bankName || ''
        },
        requestedAt: request.createdAt
      }
    });
  } catch (error) {
    console.error('createWithdrawalRequest error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to create withdrawal request' });
  }
};

// ─── CUSTOMER: Get my withdrawal requests ─────────────────────────────────────
// GET /api/withdrawals/my-requests
export const getMyWithdrawalRequests = async (req, res) => {
  try {
    const customerId = req.customerId;
    const { status, page = 1, limit = 10 } = req.query;

    const query = { customerId };
    if (status && status !== 'all') query.status = status;

    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 10;

    const [requests, total] = await Promise.all([
      CustomerWithdrawalRequest.find(query)
        .sort({ createdAt: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .select('-walletTransactionId -refundTransactionId'),
      CustomerWithdrawalRequest.countDocuments(query)
    ]);

    // Mask account number in results
    const masked = requests.map(r => {
      const obj = r.toObject();
      if (obj.bankDetails?.accountNumber) {
        obj.bankDetails.accountNumber = `****${obj.bankDetails.accountNumber.slice(-4)}`;
      }
      return obj;
    });

    const wallet = await getOrCreateWallet(customerId);

    res.json({
      success: true,
      data: masked,
      walletBalance: wallet.balance,
      pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) }
    });
  } catch (error) {
    console.error('getMyWithdrawalRequests error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch withdrawal requests' });
  }
};

// ─── CUSTOMER: Cancel a pending request ───────────────────────────────────────
// POST /api/withdrawals/:id/cancel
export const cancelWithdrawalRequest = async (req, res) => {
  try {
    const customerId = req.customerId;
    const request = await CustomerWithdrawalRequest.findById(req.params.id);

    if (!request) {
      return res.status(404).json({ success: false, message: 'Withdrawal request not found' });
    }
    if (request.customerId.toString() !== customerId.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }
    if (request.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: `Cannot cancel a request with status '${request.status}'. Only pending requests can be cancelled.`
      });
    }

    // Refund wallet
    const wallet = await getOrCreateWallet(customerId);
    const prevBalance = wallet.balance;
    wallet.balance += request.amount;
    await wallet.save();

    // Create refund transaction
    const refundTxn = await CustomerWalletTransaction.create({
      customerId,
      amount: request.amount,
      type: 'credit',
      transactionCategory: 'refund',
      description: `Refund for cancelled withdrawal request ₹${request.amount}`,
      previousBalance: prevBalance,
      newBalance: wallet.balance,
      status: 'completed'
    });

    // Mark original debit as failed
    if (request.walletTransactionId) {
      await CustomerWalletTransaction.findByIdAndUpdate(request.walletTransactionId, { status: 'failed' });
    }

    request.status = 'cancelled';
    request.refundedAt = new Date();
    request.refundTransactionId = refundTxn._id;
    await request.save();

    res.json({
      success: true,
      message: `Withdrawal request cancelled. ₹${request.amount} has been refunded to your wallet.`,
      data: { requestId: request._id, status: 'cancelled', walletBalance: wallet.balance }
    });
  } catch (error) {
    console.error('cancelWithdrawalRequest error:', error);
    res.status(500).json({ success: false, message: 'Failed to cancel withdrawal request' });
  }
};

// ─── ADMIN: Get all withdrawal requests ───────────────────────────────────────
// GET /api/withdrawals/admin/all
export const getAllWithdrawalRequests = async (req, res) => {
  try {
    const { status, search, page = 1, limit = 10, startDate, endDate } = req.query;

    const query = {};
    if (status && status !== 'all') query.status = status;
    if (search) {
      query.$or = [
        { customerName:  { $regex: search, $options: 'i' } },
        { customerPhone: { $regex: search, $options: 'i' } }
      ];
    }
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate)   query.createdAt.$lte = new Date(new Date(endDate).setHours(23, 59, 59, 999));
    }

    const pageNum  = parseInt(page, 10)  || 1;
    const limitNum = parseInt(limit, 10) || 10;

    const [requests, total] = await Promise.all([
      CustomerWithdrawalRequest.find(query)
        .sort({ createdAt: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .populate('reviewedBy', 'name email'),
      CustomerWithdrawalRequest.countDocuments(query)
    ]);

    // Summary stats
    const [pendingCount, approvedCount, paidCount, rejectedCount, cancelledCount,
           pendingAmount, approvedAmount, paidAmount] = await Promise.all([
      CustomerWithdrawalRequest.countDocuments({ status: 'pending' }),
      CustomerWithdrawalRequest.countDocuments({ status: 'approved' }),
      CustomerWithdrawalRequest.countDocuments({ status: 'paid' }),
      CustomerWithdrawalRequest.countDocuments({ status: 'rejected' }),
      CustomerWithdrawalRequest.countDocuments({ status: 'cancelled' }),
      CustomerWithdrawalRequest.aggregate([{ $match: { status: 'pending' }  }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
      CustomerWithdrawalRequest.aggregate([{ $match: { status: 'approved' } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
      CustomerWithdrawalRequest.aggregate([{ $match: { status: 'paid' }     }, { $group: { _id: null, total: { $sum: '$amount' } } }])
    ]);

    res.json({
      success: true,
      data: requests,
      stats: {
        pending:        { count: pendingCount,   amount: pendingAmount[0]?.total  || 0 },
        approved:       { count: approvedCount,  amount: approvedAmount[0]?.total || 0 },
        paid:           { count: paidCount,      amount: paidAmount[0]?.total     || 0 },
        rejected:       { count: rejectedCount },
        cancelled:      { count: cancelledCount }
      },
      pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) }
    });
  } catch (error) {
    console.error('getAllWithdrawalRequests error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch withdrawal requests' });
  }
};

// ─── ADMIN: Get single request detail ─────────────────────────────────────────
// GET /api/withdrawals/admin/:id
export const getWithdrawalRequestById = async (req, res) => {
  try {
    const request = await CustomerWithdrawalRequest.findById(req.params.id)
      .populate('reviewedBy', 'name email')
      .populate('walletTransactionId')
      .populate('refundTransactionId');

    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found' });
    }
    res.json({ success: true, data: request });
  } catch (error) {
    console.error('getWithdrawalRequestById error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch request' });
  }
};

// ─── ADMIN: Approve request (admin will now manually send money) ───────────────
// PUT /api/withdrawals/admin/:id/approve
export const approveWithdrawalRequest = async (req, res) => {
  try {
    const adminId = req.admin?.id || req.adminId;
    const { adminNote } = req.body;

    const request = await CustomerWithdrawalRequest.findById(req.params.id);
    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found' });
    }
    if (request.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: `Cannot approve a request with status '${request.status}'`
      });
    }

    request.status     = 'approved';
    request.reviewedAt = new Date();
    request.reviewedBy = adminId;
    if (adminNote) request.adminNote = adminNote;
    await request.save();

    // Update wallet transaction status
    if (request.walletTransactionId) {
      await CustomerWalletTransaction.findByIdAndUpdate(request.walletTransactionId, { status: 'processing' });
    }

    res.json({
      success: true,
      message: `Withdrawal request approved. Please transfer ₹${request.amount} to ${request.bankDetails.accountHolderName} (${request.bankDetails.accountNumber}) and then mark it as paid.`,
      data: {
        requestId: request._id,
        status: 'approved',
        amount: request.amount,
        bankDetails: request.bankDetails,
        customerName: request.customerName,
        customerPhone: request.customerPhone
      }
    });
  } catch (error) {
    console.error('approveWithdrawalRequest error:', error);
    res.status(500).json({ success: false, message: 'Failed to approve request' });
  }
};

// ─── ADMIN: Mark as paid (after manual bank transfer) ─────────────────────────
// PUT /api/withdrawals/admin/:id/mark-paid
export const markWithdrawalPaid = async (req, res) => {
  try {
    const adminId = req.admin?.id || req.adminId;
    const { transactionRef, adminNote } = req.body;

    if (!transactionRef) {
      return res.status(400).json({
        success: false,
        message: 'transactionRef (UTR number / transfer reference) is required to mark as paid'
      });
    }

    const request = await CustomerWithdrawalRequest.findById(req.params.id);
    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found' });
    }
    if (!['pending', 'approved'].includes(request.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot mark a '${request.status}' request as paid`
      });
    }

    request.status         = 'paid';
    request.reviewedAt     = request.reviewedAt || new Date();
    request.reviewedBy     = request.reviewedBy || adminId;
    request.transactionRef = transactionRef;
    request.paidAt         = new Date();
    if (adminNote) request.adminNote = adminNote;
    await request.save();

    // Mark wallet transaction as completed
    if (request.walletTransactionId) {
      await CustomerWalletTransaction.findByIdAndUpdate(request.walletTransactionId, {
        status: 'completed',
        transactionId: transactionRef
      });
    }

    res.json({
      success: true,
      message: `Withdrawal of ₹${request.amount} marked as paid. UTR: ${transactionRef}`,
      data: {
        requestId: request._id,
        status: 'paid',
        amount: request.amount,
        transactionRef,
        paidAt: request.paidAt,
        customerName: request.customerName,
        customerPhone: request.customerPhone
      }
    });
  } catch (error) {
    console.error('markWithdrawalPaid error:', error);
    res.status(500).json({ success: false, message: 'Failed to mark request as paid' });
  }
};

// ─── ADMIN: Reject request & refund wallet ────────────────────────────────────
// PUT /api/withdrawals/admin/:id/reject
export const rejectWithdrawalRequest = async (req, res) => {
  try {
    const adminId = req.admin?.id || req.adminId;
    const { reason, adminNote } = req.body;

    if (!reason) {
      return res.status(400).json({ success: false, message: 'Rejection reason is required' });
    }

    const request = await CustomerWithdrawalRequest.findById(req.params.id);
    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found' });
    }
    if (!['pending', 'approved'].includes(request.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot reject a '${request.status}' request`
      });
    }

    // Refund wallet
    const wallet = await getOrCreateWallet(request.customerId);
    const prevBalance = wallet.balance;
    wallet.balance += request.amount;
    await wallet.save();

    // Create refund transaction
    const refundTxn = await CustomerWalletTransaction.create({
      customerId: request.customerId,
      amount: request.amount,
      type: 'credit',
      transactionCategory: 'refund',
      description: `Refund for rejected withdrawal request ₹${request.amount}. Reason: ${reason}`,
      previousBalance: prevBalance,
      newBalance: wallet.balance,
      status: 'completed'
    });

    // Mark original debit as failed
    if (request.walletTransactionId) {
      await CustomerWalletTransaction.findByIdAndUpdate(request.walletTransactionId, { status: 'failed' });
    }

    request.status            = 'rejected';
    request.reviewedAt        = new Date();
    request.reviewedBy        = adminId;
    request.rejectionReason   = reason;
    request.refundedAt        = new Date();
    request.refundTransactionId = refundTxn._id;
    if (adminNote) request.adminNote = adminNote;
    await request.save();

    res.json({
      success: true,
      message: `Withdrawal request rejected. ₹${request.amount} has been refunded to customer's wallet.`,
      data: {
        requestId: request._id,
        status: 'rejected',
        reason,
        refundAmount: request.amount,
        customerName: request.customerName,
        customerPhone: request.customerPhone
      }
    });
  } catch (error) {
    console.error('rejectWithdrawalRequest error:', error);
    res.status(500).json({ success: false, message: 'Failed to reject request' });
  }
};

// ─── ADMIN: Dashboard stats ────────────────────────────────────────────────────
// GET /api/withdrawals/admin/stats
export const getWithdrawalStats = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [totalPending, totalPaid, todayRequests, totalAmountPaid, totalAmountPending] =
      await Promise.all([
        CustomerWithdrawalRequest.countDocuments({ status: 'pending' }),
        CustomerWithdrawalRequest.countDocuments({ status: 'paid' }),
        CustomerWithdrawalRequest.countDocuments({ createdAt: { $gte: today } }),
        CustomerWithdrawalRequest.aggregate([
          { $match: { status: 'paid' } },
          { $group: { _id: null, total: { $sum: '$amount' } } }
        ]),
        CustomerWithdrawalRequest.aggregate([
          { $match: { status: { $in: ['pending', 'approved'] } } },
          { $group: { _id: null, total: { $sum: '$amount' } } }
        ])
      ]);

    res.json({
      success: true,
      data: {
        pendingRequests:    totalPending,
        totalPaidRequests:  totalPaid,
        todayRequests,
        totalAmountPaid:    totalAmountPaid[0]?.total    || 0,
        pendingAmount:      totalAmountPending[0]?.total || 0
      }
    });
  } catch (error) {
    console.error('getWithdrawalStats error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch stats' });
  }
};
