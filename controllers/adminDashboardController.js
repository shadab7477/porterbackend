import Ride from '../models/Ride.js';
import Driver from '../models/Driver.js';
import Customer from '../models/Customer.js';
import Payment from '../models/Payment.js';
import DriverApplication from '../models/DriverApplication.js';

export const getDashboardStats = async (req, res) => {
  try {
    const currentYear = new Date().getFullYear();
    const startOfYear = new Date(currentYear, 0, 1);
    const endOfYear = new Date(currentYear, 11, 31, 23, 59, 59);

    // 1. Basic Counts
    const [
      totalDrivers,
      onlineDrivers,
      totalCustomers,
      totalRides,
      completedRides,
      pendingRides,
      activeRides,
      totalRideRevenueResult,
      totalPaymentRevenueResult
    ] = await Promise.all([
      Driver.countDocuments({}),
      Driver.countDocuments({ isOnline: true }),
      Customer.countDocuments({}),
      Ride.countDocuments({}),
      Ride.countDocuments({ status: 'completed' }),
      Ride.countDocuments({ status: { $in: ['requested', 'searching', 'no_drivers'] } }),
      Ride.countDocuments({ status: { $in: ['driver_assigned', 'driver_arrived', 'in_progress'] } }),
      // Ride completed total fare sum
      Ride.aggregate([
        { $match: { status: 'completed' } },
        { $group: { _id: null, total: { $sum: '$fare.total' } } }
      ]),
      // Payments success amount sum
      Payment.aggregate([
        { $match: { status: 'success' } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
      ])
    ]);

    const rideRevenue = totalRideRevenueResult[0]?.total || 0;
    const paymentRevenue = totalPaymentRevenueResult[0]?.total || 0;
    const totalRevenue = rideRevenue + paymentRevenue;

    // 2. 12-Month Revenue & Orders breakdown for current year
    const monthlyAggregation = await Ride.aggregate([
      {
        $match: {
          requestedAt: { $gte: startOfYear, $lte: endOfYear }
        }
      },
      {
        $group: {
          _id: { $month: '$requestedAt' },
          ord: { $sum: 1 },
          rev: {
            $sum: {
              $cond: [{ $eq: ['$status', 'completed'] }, '$fare.total', 0]
            }
          }
        }
      }
    ]);

    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthlyChart = monthNames.map((monthName, idx) => {
      const monthNumber = idx + 1;
      const found = monthlyAggregation.find(m => m._id === monthNumber);
      return {
        m: monthName,
        rev: found ? Math.round(found.rev) : 0,
        ord: found ? found.ord : 0
      };
    });

    // 3. Ride Sources (Distribution for donut chart)
    const pie = [
      { name: 'Pending', v: pendingRides, color: '#f59e0b' },
      { name: 'Active',  v: activeRides,  color: '#FFB304' },
      { name: 'Done',    v: completedRides, color: '#16a34a' }
    ];

    // 4. Current Month Goals
    const now = new Date();
    const startOfCurrentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const currentMonthRevenueResult = await Ride.aggregate([
      {
        $match: {
          status: 'completed',
          requestedAt: { $gte: startOfCurrentMonth }
        }
      },
      { $group: { _id: null, total: { $sum: '$fare.total' } } }
    ]);
    const currentMonthRevenue = Math.round(currentMonthRevenueResult[0]?.total || 0);

    const goals = [
      {
        label: 'Monthly Revenue',
        cur: currentMonthRevenue,
        target: 65000,
        disp: `₹${currentMonthRevenue.toLocaleString()}`,
        tdsp: '₹65,000'
      },
      {
        label: 'Active Drivers',
        cur: onlineDrivers,
        target: 50,
        disp: `${onlineDrivers}`,
        tdsp: '50'
      },
      {
        label: 'Total Rides',
        cur: totalRides,
        target: 600,
        disp: `${totalRides}`,
        tdsp: '600'
      }
    ];

    res.json({
      success: true,
      data: {
        totalRevenue: Math.round(totalRevenue),
        totalDrivers,
        onlineDrivers,
        totalCustomers,
        totalOrders: totalRides,
        monthlyChart,
        pie,
        goals
      }
    });
  } catch (error) {
    console.error('getDashboardStats error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch dashboard statistics' });
  }
};
