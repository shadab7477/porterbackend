import Ride from '../models/Ride.js';
import Driver from '../models/Driver.js';
import Customer from '../models/Customer.js';
import WalletTransaction from '../models/WalletTransaction.js';
import axios from 'axios';

// Google Maps API configuration
const GOOGLE_MAPS_API_KEY = "AIzaSyCgpFAvw-8Q8nHEHz4z5ztx449xZLkilyk";
const GOOGLE_MAPS_API_URL = "https://maps.googleapis.com/maps/api";

// ==================== HELPER FUNCTIONS ====================

// Calculate distance and duration using Google Maps API
export const calculateDistanceAndDuration = async (
  originLat,
  originLon,
  destLat,
  destLon,
  vehicleType = "car"
) => {
  try {
    const response = await axios.post(
      "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix",
      {
        origins: [
          {
            waypoint: {
              location: {
                latLng: {
                  latitude: originLat,
                  longitude: originLon
                }
              }
            }
          }
        ],
        destinations: [
          {
            waypoint: {
              location: {
                latLng: {
                  latitude: destLat,
                  longitude: destLon
                }
              }
            }
          }
        ],
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_AWARE"
      },
      {
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": GOOGLE_MAPS_API_KEY,
          "X-Goog-FieldMask": "distanceMeters,duration"
        }
      }
    );

    const element = response.data[0];

    if (!element || !element.distanceMeters) {
      throw new Error("No route found");
    }

    const distanceInKm = element.distanceMeters / 1000;
    const durationInSeconds = parseInt(element.duration.replace("s", ""));
    const durationInMinutes = Math.ceil(durationInSeconds / 60);

    return {
      distance: parseFloat(distanceInKm.toFixed(2)),
      duration: durationInMinutes,
      durationInTraffic: durationInMinutes,
      distanceText: `${distanceInKm.toFixed(1)} km`,
      durationText: `${durationInMinutes} mins`,
      durationInTrafficText: `${durationInMinutes} mins`
    };

  } catch (error) {
    console.error("Google Maps API error:", error.response?.data || error.message);
    return fallbackCalculateDistanceAndDuration(
      originLat,
      originLon,
      destLat,
      destLon,
      vehicleType
    );
  }
};

// Fallback Haversine formula calculation
const fallbackCalculateDistanceAndDuration = (lat1, lon1, lat2, lon2, vehicleType = 'car') => {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;

  const avgSpeeds = {
    'bike': 30,
    'auto': 25,
    'car': 30,
    'mini_truck': 25,
    'truck': 20
  };
  const speed = avgSpeeds[vehicleType] || 30;
  const duration = Math.ceil((distance / speed) * 60);

  return {
    distance: parseFloat(distance.toFixed(2)),
    duration,
    durationInTraffic: duration,
    distanceText: `${distance.toFixed(1)} km`,
    durationText: `${duration} mins`,
    durationInTrafficText: `${duration} mins`
  };
};

// Calculate Haversine distance
const calculateHaversineDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

// Format relative time
const formatRelativeTime = (date) => {
  const now = new Date();
  const diffInSeconds = Math.floor((now - new Date(date)) / 1000);

  if (diffInSeconds < 60) return `${diffInSeconds} seconds ago`;
  if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)} minutes ago`;
  if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)} hours ago`;
  return `${Math.floor(diffInSeconds / 86400)} days ago`;
};

// Check if current time is peak hour (keeping for compatibility but not used in fare)
const isPeakHour = () => {
  const hour = new Date().getHours();
  return (hour >= 8 && hour <= 10) || (hour >= 17 && hour <= 20);
};

// ==================== MAIN FUNCTION: GET DRIVER PENDING REQUESTS ====================
export const getDriverPendingRequests = async (req, res) => {
  try {
    const driverId = req.driver.id;

    // Get driver details
    const driver = await Driver.findById(driverId);
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found'
      });
    }

    // Check if driver is online
    if (!driver.isOnline) {
      return res.json({
        success: true,
        data: {
          pendingRequests: [],
          count: 0,
          message: 'You are offline. Please go online to see ride requests.',
          driverLocation: null
        }
      });
    }

    // Get driver's current location
    if (!driver.currentLocation || !driver.currentLocation.coordinates ||
      driver.currentLocation.coordinates.length < 2) {
      return res.json({
        success: true,
        data: {
          pendingRequests: [],
          count: 0,
          message: 'Please enable location to see nearby ride requests',
          driverLocation: null
        }
      });
    }

    const [driverLon, driverLat] = driver.currentLocation.coordinates;

    console.log('🔍 Driver Location:', { lat: driverLat, lon: driverLon });
    console.log('🔍 Driver Vehicle Type:', driver.vehicleType);

    // TRY APPROACH 1: $geoNear (requires 2dsphere index)
    try {
      const pendingRides = await Ride.aggregate([
        {
          $geoNear: {
            near: {
              type: 'Point',
              coordinates: [parseFloat(driverLon), parseFloat(driverLat)]
            },
            distanceField: 'distanceFromDriver',
            maxDistance: 5 * 1000,
            spherical: true,
            query: {
              status: 'searching',
              'driver.driverId': { $exists: false },
              requestedVehicleType: driver.vehicleType
            }
          }
        },
        {
          $lookup: {
            from: 'customers',
            localField: 'customer.customerId',
            foreignField: '_id',
            as: 'customerDetails'
          }
        },
        {
          $addFields: {
            customerInfo: { $arrayElemAt: ['$customerDetails', 0] }
          }
        },
        {
          $project: {
            rideId: 1,
            'customer.customerId': 1,
            'customer.name': 1,
            'customer.rating': 1,
            'customerInfo.name': 1,
            'customerInfo.rating': 1,
            'customerInfo.totalTrips': 1,
            pickupLocation: 1,
            dropLocation: 1,
            distance: 1,
            duration: 1,
            routeInfo: 1,
            fare: 1,
            requestedAt: 1,
            driversNotified: 1,
            distanceFromDriver: 1,
            status: 1
          }
        },
        { $sort: { requestedAt: -1 } },
        { $limit: 20 }
      ]);

      console.log('✅ GeoNear found:', pendingRides.length, 'rides');
      return await processRides(pendingRides, driver, driverId, driverLat, driverLon, res);

    } catch (geoError) {
      console.log('⚠️ GeoNear failed, trying $near:', geoError.message);

      // TRY APPROACH 2: $near (also requires index)
      try {
        const pendingRides = await Ride.find({
          status: 'searching',
          'driver.driverId': { $exists: false },
          requestedVehicleType: driver.vehicleType,
          pickupLocation: {
            $near: {
              $geometry: {
                type: 'Point',
                coordinates: [parseFloat(driverLon), parseFloat(driverLat)]
              },
              $maxDistance: 5000
            }
          }
        })
          .sort({ requestedAt: -1 })
          .limit(20)
          .lean();

        console.log('✅ $near found:', pendingRides.length, 'rides');

        // Add distance field manually
        const ridesWithDistance = pendingRides.map(ride => {
          const [pickupLon, pickupLat] = ride.pickupLocation.coordinates;
          const distance = calculateHaversineDistance(
            driverLat, driverLon,
            pickupLat, pickupLon
          );
          return {
            ...ride,
            distanceFromDriver: distance * 1000
          };
        });

        return await processRides(ridesWithDistance, driver, driverId, driverLat, driverLon, res);

      } catch (nearError) {
        console.log('⚠️ $near failed, using manual calculation:', nearError.message);

        // TRY APPROACH 3: Manual calculation (no index needed)
        const allRides = await Ride.find({
          status: 'searching',
          'driver.driverId': { $exists: false },
          requestedVehicleType: driver.vehicleType
        })
          .sort({ requestedAt: -1 })
          .limit(50)
          .lean();

        // Calculate distance manually and filter within 5km
        const ridesWithDistance = allRides
          .map(ride => {
            const [pickupLon, pickupLat] = ride.pickupLocation.coordinates;
            const distance = calculateHaversineDistance(
              driverLat, driverLon,
              pickupLat, pickupLon
            );
            return {
              ...ride,
              distanceFromDriver: distance * 1000
            };
          })
          .filter(ride => ride.distanceFromDriver <= 5000)
          .sort((a, b) => a.distanceFromDriver - b.distanceFromDriver)
          .slice(0, 20);

        console.log('✅ Manual calculation found:', ridesWithDistance.length, 'rides');
        return await processRides(ridesWithDistance, driver, driverId, driverLat, driverLon, res);
      }
    }

  } catch (error) {
    console.error('❌ Get driver pending requests error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to get pending requests'
    });
  }
};

// Helper function to process rides
async function processRides(pendingRides, driver, driverId, driverLat, driverLon, res) {
  // const [driverLon] = driver.currentLocation.coordinates;

  if (pendingRides.length === 0) {
    return res.json({
      success: true,
      data: {
        pendingRequests: [],
        count: 0,
        message: 'No ride requests available within 5km of your location',
        driverLocation: {
          coordinates: [driverLon, driverLat],
          address: driver.currentLocation.address || 'Current location'
        }
      }
    });
  }

  // Process each ride
  const pendingRequests = await Promise.all(pendingRides.map(async (ride) => {
    try {
      // Check if driver was notified
      const wasNotified = ride.driversNotified?.some(
        d => d.driverId && d.driverId.toString() === driverId.toString()
      );

      // Check if driver already responded
      const hasResponded = ride.driversNotified?.some(
        d => d.driverId && d.driverId.toString() === driverId.toString() &&
          d.response && d.response !== 'pending'
      );

      if (hasResponded) return null;

      // Calculate expiration time
      let expiresIn = 120;
      if (wasNotified) {
        const notification = ride.driversNotified?.find(
          d => d.driverId && d.driverId.toString() === driverId.toString()
        );
        if (notification?.notifiedAt) {
          const timeElapsed = Math.floor((Date.now() - new Date(notification.notifiedAt).getTime()) / 1000);
          expiresIn = Math.max(0, 120 - timeElapsed);
          if (expiresIn <= 0) return null;
        }
      }

      // Calculate ETA
      const [pickupLon, pickupLat] = ride.pickupLocation.coordinates;
      let etaToPickup = null;
      let etaText = null;

      try {
        const distanceInfo = await calculateDistanceAndDuration(
          driverLat, driverLon,
          pickupLat, pickupLon,
          driver.vehicleType
        );
        etaToPickup = distanceInfo.duration;
        etaText = distanceInfo.durationText;
      } catch (err) {
        const distanceInKm = ride.distanceFromDriver / 1000;
        etaToPickup = Math.ceil((distanceInKm / 30) * 60);
        etaText = `${etaToPickup} mins`;
      }

      // Get customer info
      const customerName = ride.customerInfo?.name || ride.customer?.name || 'Customer';
      const customerRating = ride.customerInfo?.rating || ride.customer?.rating || 0;
      const customerTotalRides = ride.customerInfo?.totalTrips || 0;

      return {
        rideId: ride.rideId,
        customerDetails: {
          name: customerName,
          rating: customerRating,
          totalRides: customerTotalRides
        },
        pickupLocation: {
          address: ride.pickupLocation.address || 'Pickup location',
          coordinates: ride.pickupLocation.coordinates,
          distanceFromDriver: parseFloat((ride.distanceFromDriver / 1000).toFixed(1)),
          distanceText: `${(ride.distanceFromDriver / 1000).toFixed(1)} km`,
          eta: etaToPickup,
          etaText: etaText
        },
        dropLocation: {
          address: ride.dropLocation.address || 'Drop location',
          coordinates: ride.dropLocation.coordinates
        },
        dropLocations: ride.dropLocations || [],
        totalStops: ride.dropLocations?.length || 1,
        rideDetails: {
          distance: ride.distance,
          distanceText: ride.routeInfo?.distanceText || `${ride.distance} km`,
          duration: ride.duration,
          durationText: ride.routeInfo?.durationText || `${ride.duration} mins`,
          estimatedFare: ride.fare?.total || 0,
          fareBreakdown: {
            distanceFare: ride.fare?.distanceFare || 0,
            total: ride.fare?.total || 0
          },
          legDistances: ride.legDistances || []
        },
        requestedAt: ride.requestedAt,
        requestedTime: formatRelativeTime(ride.requestedAt),
        expiresIn: expiresIn,
        expiresInText: expiresIn > 0 ? `${expiresIn} seconds` : 'Expired',
        wasNotified: wasNotified,
        isNew: !wasNotified
      };
    } catch (err) {
      console.error('Error processing ride:', err);
      return null;
    }
  }));

  // Filter out null values
  const validRequests = pendingRequests.filter(r => r !== null);

  // Sort requests
  validRequests.sort((a, b) => {
    if (a.wasNotified && !b.wasNotified) return -1;
    if (!a.wasNotified && b.wasNotified) return 1;
    if (a.wasNotified && b.wasNotified) {
      return a.expiresIn - b.expiresIn;
    }
    return a.pickupLocation.distanceFromDriver - b.pickupLocation.distanceFromDriver;
  });

  res.json({
    success: true,
    data: {
      pendingRequests: validRequests,
      count: validRequests.length,
      searchRadius: 5,
      driverLocation: {
        coordinates: [driverLon, driverLat],
        address: driver.currentLocation.address || 'Current location'
      },
      driverStatus: {
        isOnline: driver.isOnline,
        isAvailable: driver.isAvailable,
        vehicleType: driver.vehicleType
      },
      summary: {
        totalAvailable: validRequests.length,
        notifiedRequests: validRequests.filter(r => r.wasNotified).length,
        newRequests: validRequests.filter(r => !r.wasNotified).length,
        averageDistance: validRequests.length > 0
          ? (validRequests.reduce((sum, r) => sum + r.pickupLocation.distanceFromDriver, 0) / validRequests.length).toFixed(1)
          : 0
      }
    }
  });
}

// ==================== RIDE REQUEST FLOW FUNCTIONS ====================

// 1. Customer requests a ride - UPDATED with multi-drop location support (max 4 drops)
export const requestRide = async (req, res) => {
  try {
    const customerId = req.customerId;
    const {
      pickupLocation,
      dropLocation,
      dropLocations,
      vehicleType = 'car',
      paymentMethod = 'cash',
      paymentCollectedBy = 'customer',  // 'customer' | 'receiver'
      receiver
    } = req.body;

    const customer = await Customer.findById(customerId);
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }

    if (customer.isBlocked) {
      return res.status(403).json({
        success: false,
        message: 'Your account has been blocked'
      });
    }

    // Build the drop locations array - support both single and multi-drop
    let allDropLocations = [];
    if (dropLocations && Array.isArray(dropLocations) && dropLocations.length > 0) {
      allDropLocations = dropLocations;
    } else if (dropLocation?.coordinates) {
      allDropLocations = [dropLocation];
    }

    if (!pickupLocation?.coordinates || allDropLocations.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Please provide pickup location and at least one drop location with coordinates'
      });
    }

    // Validate max 4 drop locations
    if (allDropLocations.length > 4) {
      return res.status(400).json({
        success: false,
        message: 'Maximum 4 drop locations allowed'
      });
    }

    // Validate all drop locations have coordinates
    for (let i = 0; i < allDropLocations.length; i++) {
      if (!allDropLocations[i]?.coordinates || allDropLocations[i].coordinates.length < 2) {
        return res.status(400).json({
          success: false,
          message: `Drop location ${i + 1} is missing coordinates`
        });
      }
    }

    const [pickupLon, pickupLat] = pickupLocation.coordinates;

    // Calculate leg-by-leg distances sequentially
    const legDistances = [];
    let totalDistance = 0;
    let totalDuration = 0;
    let prevLat = pickupLat;
    let prevLon = pickupLon;

    for (let i = 0; i < allDropLocations.length; i++) {
      const [dropLon, dropLat] = allDropLocations[i].coordinates;
      const legInfo = await calculateDistanceAndDuration(
        prevLat, prevLon,
        dropLat, dropLon,
        vehicleType
      );

      legDistances.push({
        from: i === 0 ? 'pickup' : `drop_${i}`,
        to: `drop_${i + 1}`,
        distance: legInfo.distance,
        duration: legInfo.duration,
        distanceText: legInfo.distanceText,
        durationText: legInfo.durationText
      });

      totalDistance += legInfo.distance;
      totalDuration += legInfo.duration;
      prevLat = dropLat;
      prevLon = dropLon;
    }

    totalDistance = parseFloat(totalDistance.toFixed(2));

    // Calculate fare based on total cumulative distance (merchant gets 5% discount)
    const isMerchant = customer.isMerchant || false;
    const fare = await Ride.calculateFare(totalDistance, vehicleType, isMerchant);


    // The final/last drop location for backward compatibility
    const finalDrop = allDropLocations[allDropLocations.length - 1];
    const [finalDropLon, finalDropLat] = finalDrop.coordinates;

    // Build dropLocations array for storage
    const formattedDropLocations = allDropLocations.map((loc, idx) => ({
      type: 'Point',
      coordinates: [parseFloat(loc.coordinates[0]), parseFloat(loc.coordinates[1])],
      address: loc.address || `Drop location ${idx + 1}`
    }));

    const ride = new Ride({
      requestedVehicleType: vehicleType,
      customer: {
        customerId,
        name: customer.name || 'Customer',
        phone: customer.phone,
        rating: customer.rating || 0
      },
      receiver: {
        name: receiver?.name || '',
        phone: receiver?.phone || ''
      },
      pickupLocation: {
        type: 'Point',
        coordinates: [parseFloat(pickupLon), parseFloat(pickupLat)],
        address: pickupLocation.address || 'Pickup location'
      },
      // Last drop for backward compatibility
      dropLocation: {
        type: 'Point',
        coordinates: [parseFloat(finalDropLon), parseFloat(finalDropLat)],
        address: finalDrop.address || 'Drop location'
      },
      // All drop locations
      dropLocations: formattedDropLocations,
      // Leg-by-leg distance breakdown
      legDistances,
      currentDropIndex: 0,
      distance: totalDistance,
      duration: totalDuration,
      routeInfo: {
        distanceText: `${totalDistance.toFixed(1)} km`,
        durationText: `${totalDuration} mins`,
        durationInTrafficText: `${totalDuration} mins`
      },
      fare: {
        distanceFare:     fare.distanceFare,
        total:            fare.total,
        discount:         fare.discount,
        cashbackAmount:   fare.cashbackAmount,
        finalAmount:      fare.finalAmount,
        isMerchantRide:   fare.isMerchantRide,
        merchantDiscount: fare.merchantDiscount
      },
      paymentMethod,
      paymentCollectedBy: paymentMethod === 'cash' || paymentMethod === 'wallet' ? 'customer' : paymentCollectedBy,
      paymentStatus: 'pending',
      status: 'requested'
    });

    // ====== WALLET: Pre-check balance at booking time ======
    if (paymentMethod === 'wallet') {
      const freshCustomer = await Customer.findById(customerId).select('walletBalance');
      if (!freshCustomer || freshCustomer.walletBalance < fare.finalAmount) {
        return res.status(400).json({
          success: false,
          message: `Insufficient wallet balance. Your balance is ₹${freshCustomer?.walletBalance || 0}, ride fare is ₹${fare.finalAmount}. Please top up your wallet first.`,
          walletBalance: freshCustomer?.walletBalance || 0,
          required: fare.finalAmount
        });
      }
    }
    // ======================================================

    await ride.save();

    const io = req.app.get('io');
    io.emit('ride:requested', {
      rideId: ride.rideId,
      customerId,
      pickupLocation: ride.pickupLocation,
      dropLocation: ride.dropLocation,
      dropLocations: ride.dropLocations,
      totalStops: ride.dropLocations.length
    });

    findNearbyDrivers(ride, req.app.get('io'));

    res.status(201).json({
      success: true,
      message: 'Ride requested successfully',
      data: {
        rideId: ride.rideId,
        status: ride.status,
        pickupLocation: ride.pickupLocation,
        dropLocation: ride.dropLocation,
        dropLocations: ride.dropLocations,
        legDistances: ride.legDistances,
        totalStops: ride.dropLocations.length,
        receiver: ride.receiver,
        distance: ride.distance,
        distanceText: `${totalDistance.toFixed(1)} km`,
        duration: ride.duration,
        durationText: `${totalDuration} mins`,
        fare: ride.fare,
        fareBreakdown: {
          ...fare.breakdown,
          legs: legDistances.map((leg, idx) => ({
            leg: `${leg.from} → ${leg.to}`,
            distance: leg.distanceText,
            duration: leg.durationText
          })),
          totalDistance: `${totalDistance.toFixed(1)} km`,
          totalFare: `₹${fare.finalAmount}`,
          merchantDiscount: fare.isMerchantRide
            ? { applied: true, percent: fare.merchantDiscount, cashback: `₹${fare.cashbackAmount}` }
            : { applied: false }
        },
        isMerchantRide: fare.isMerchantRide,
        paymentMethod: ride.paymentMethod
      }
    });

  } catch (error) {
    console.error('Request ride error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to request ride'
    });
  }
};

// 2. Find nearby drivers (internal function)
const findNearbyDrivers = async (ride, io, radius = 5) => {
  try {
    const [longitude, latitude] = ride.pickupLocation.coordinates;

    ride.status = 'searching';
    await ride.save();

    const nearbyDrivers = await Driver.aggregate([
      {
        $geoNear: {
          near: {
            type: 'Point',
            coordinates: [parseFloat(longitude), parseFloat(latitude)]
          },
          distanceField: 'distanceFromPickup',
          maxDistance: radius * 1000,
          spherical: true,
          query: {
            isOnline: true,
            isAvailable: true,
            isBlocked: false,
            vehicleType: ride.requestedVehicleType || 'car'
          }
        }
      },
      { $limit: 10 }
    ]);

    if (nearbyDrivers.length === 0) {
      ride.status = 'no_drivers';
      await ride.save();

      io.emit(`ride:${ride.rideId}:no_drivers`, {
        rideId: ride.rideId,
        message: 'No drivers available in your area'
      });
      return;
    }

    const notifiedDrivers = [];

    for (const driver of nearbyDrivers) {
      const [driverLon, driverLat] = driver.currentLocation.coordinates;
      const etaInfo = await calculateDistanceAndDuration(
        driverLat, driverLon,
        latitude, longitude,
        driver.vehicleType
      );

      notifiedDrivers.push({
        driverId: driver._id,
        notifiedAt: new Date(),
        response: 'pending',
        distanceToPickup: etaInfo.distance,
        durationToPickup: etaInfo.duration,
        distanceFromPickup: driver.distanceFromPickup / 1000
      });

      io.of('/drivers').to(`driver:${driver._id}`).emit('ride:new_request', {
        rideId: ride.rideId,
        pickupLocation: ride.pickupLocation,
        dropLocation: ride.dropLocation,
        dropLocations: ride.dropLocations || [],
        totalStops: ride.dropLocations?.length || 1,
        distance: ride.distance,
        distanceText: ride.routeInfo.distanceText,
        estimatedFare: ride.fare.total,
        customerRating: ride.customer.rating,
        distanceFromDriver: etaInfo.distance,
        distanceFromDriverText: etaInfo.distanceText,
        etaToPickup: etaInfo.duration,
        etaToPickupText: etaInfo.durationText,
        expiresIn: 120
      });
    }

    ride.driversNotified = notifiedDrivers;
    await ride.save();

    setTimeout(() => handleDriverResponseTimeout(ride, io), 120000);

  } catch (error) {
    console.error('Find nearby drivers error:', error);
  }
};

// 3. Handle driver response timeout
const handleDriverResponseTimeout = async (ride, io) => {
  try {
    const updatedRide = await Ride.findOne({ rideId: ride.rideId });

    if (!updatedRide || updatedRide.status !== 'searching') {
      return;
    }

    const acceptedDrivers = updatedRide.driversNotified.filter(
      d => d.response === 'accepted'
    );

    if (acceptedDrivers.length === 0) {
      updatedRide.status = 'no_drivers';
      await updatedRide.save();

      io.emit(`ride:${ride.rideId}:timeout`, {
        rideId: ride.rideId,
        message: 'No drivers accepted your request'
      });
    }
  } catch (error) {
    console.error('Driver response timeout error:', error);
  }
};

// 4. Driver accepts ride
export const acceptRide = async (req, res) => {
  try {
    const driverId = req.driver.id;
    const { rideId } = req.body;
    console.log(req.body);

    const driver = await Driver.findById(driverId);
    if (!driver || !driver.isOnline || !driver.isAvailable) {
      return res.status(400).json({
        success: false,
        message: 'You must be online and available to accept rides'
      });
    }
    const ride = await Ride.findOne({
      rideId,
      status: { $in: ['searching', 'no_drivers'] }
    })
    if (!ride) {
      return res.status(404).json({
        success: false,
        message: 'Ride not found or already assigned'
      });
    }

    console.log(ride);


    const [driverLon, driverLat] = driver.currentLocation.coordinates;
    const [pickupLon, pickupLat] = ride.pickupLocation.coordinates;

    const distanceToPickup = calculateHaversineDistance(
      driverLat, driverLon,
      pickupLat, pickupLon
    );

    const MAX_ACCEPTABLE_DISTANCE = 5;
    if (distanceToPickup > MAX_ACCEPTABLE_DISTANCE) {
      return res.status(400).json({
        success: false,
        message: `You are too far from pickup location (${distanceToPickup.toFixed(1)}km). Maximum allowed is ${MAX_ACCEPTABLE_DISTANCE}km.`
      });
    }

    const etaInfo = await calculateDistanceAndDuration(
      driverLat, driverLon,
      pickupLat, pickupLon,
      driver.vehicleType
    );

    const existingNotification = ride.driversNotified?.find(
      d => d.driverId && d.driverId.toString() === driverId
    );

    if (existingNotification) {
      existingNotification.response = 'accepted';
      existingNotification.respondedAt = new Date();
    } else {
      if (!ride.driversNotified) ride.driversNotified = [];
      ride.driversNotified.push({
        driverId: driver._id,
        notifiedAt: new Date(),
        response: 'accepted',
        respondedAt: new Date(),
        distanceToPickup: distanceToPickup
      });
    }

    ride.driver = {
      driverId: driver._id,
      name: driver.name,
      phone: driver.phone,
      vehicleType: driver.vehicleType,
      vehicleNumber: driver.vehicleNumber,
      rating: driver.rating || 0
    };

    ride.updateStatus('driver_assigned');
    ride.driverETA = {
      distance: etaInfo.distance,
      duration: etaInfo.duration,
      distanceText: etaInfo.distanceText,
      durationText: etaInfo.durationText
    };

    if (ride.driversNotified && ride.driversNotified.length > 0) {
      ride.driversNotified.forEach(d => {
        if (d.driverId.toString() !== driverId && d.response === 'pending') {
          d.response = 'rejected';
          d.respondedAt = new Date();
        }
      });
    }

    await ride.save();

    driver.isAvailable = false;
    await driver.save();

    const io = req.app.get('io');

    const acceptanceData = {
      rideId: ride.rideId,
      driver: {
        driverId: driver._id,
        name: driver.name,
        phone: driver.phone,
        vehicleType: driver.vehicleType,
        vehicleNumber: driver.vehicleNumber,
        rating: driver.rating,
        currentLocation: driver.currentLocation,
        lat: driverLat,
        lng: driverLon
      },
      eta: etaInfo.duration,
      etaText: etaInfo.durationText,
      distanceToPickup: etaInfo.distance,
      distanceToPickupText: etaInfo.distanceText,
      pickupLocation: ride.pickupLocation,
      dropLocation: ride.dropLocation,
      dropLocations: ride.dropLocations || [],
      totalStops: ride.dropLocations?.length || 1,
      fare: ride.fare.total
    };

    // Broadcast compatibility event
    io.emit(`ride:${ride.rideId}:accepted`, acceptanceData);

    // Notify customer on their specific channel
    io.to(`customer:${ride.customer.customerId}`).emit('ride:accepted', acceptanceData);

    // Notify customer on the ride tracking channel (default namespace room)
    io.to(`ride:${ride.rideId}`).emit('ride:accepted', acceptanceData);
    io.to(`ride:${ride.rideId}`).emit('ride:status-changed', {
      rideId: ride.rideId,
      status: 'driver_assigned',
      driver: acceptanceData.driver,
      eta: etaInfo.duration,
      etaText: etaInfo.durationText,
      timestamp: new Date(),
      message: 'Driver assigned to your ride'
    });

    if (ride.driversNotified && ride.driversNotified.length > 0) {
      ride.driversNotified.forEach(d => {
        if (d.driverId.toString() !== driverId) {
          io.to(`driver:${d.driverId}`).emit('ride:assigned_to_other', {
            rideId: ride.rideId,
            message: 'This ride was accepted by another driver'
          });
        }
      });
    }

    const distanceText = ride.routeInfo?.distanceText || `${ride.distance} km`;

    res.json({
      success: true,
      message: 'Ride accepted successfully',
      data: {
        rideId: ride.rideId,
        customer: {
          customerId: ride.customer.customerId,
          name: ride.customer.name,
          phone: ride.customer.phone
        },
        driver: {
          driverId: driver._id,
          name: driver.name,
          phone: driver.phone,
          vehicleType: driver.vehicleType,
          vehicleNumber: driver.vehicleNumber,
          rating: driver.rating,
          lat: driverLat,
          lng: driverLon
        },
        pickupLocation: ride.pickupLocation,
        dropLocation: ride.dropLocation,
        dropLocations: ride.dropLocations || [],
        totalStops: ride.dropLocations?.length || 1,
        legDistances: ride.legDistances || [],
        estimatedFare: ride.fare.total,
        distance: ride.distance,
        distanceText: distanceText,
        eta: etaInfo.duration,
        etaText: etaInfo.durationText,
        routeToPickup: {
          distance: etaInfo.distance,
          duration: etaInfo.duration,
          distanceText: etaInfo.distanceText,
          durationText: etaInfo.durationText
        }
      }
    });

  } catch (error) {
    console.error('Accept ride error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to accept ride'
    });
  }
};

// 5. Driver rejects ride
export const rejectRide = async (req, res) => {
  try {
    const driverId = req.driver.id;
    const { rideId, reason } = req.body;

    const ride = await Ride.findOne({ rideId, status: 'searching' });
    if (!ride) {
      return res.status(404).json({
        success: false,
        message: 'Ride not found'
      });
    }

    const notifiedDriver = ride.driversNotified.find(
      d => d.driverId.toString() === driverId && d.response === 'pending'
    );

    if (notifiedDriver) {
      notifiedDriver.response = 'rejected';
      notifiedDriver.respondedAt = new Date();
      notifiedDriver.rejectionReason = reason;
      await ride.save();
    }

    res.json({
      success: true,
      message: 'Ride rejected'
    });

  } catch (error) {
    console.error('Reject ride error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to reject ride'
    });
  }
};

// 6. Driver arrived at pickup
export const driverArrived = async (req, res) => {
  try {
    const driverId = req.driver.id;
    const { rideId } = req.body;

    const ride = await Ride.findOne({
      rideId,
      'driver.driverId': driverId,
      status: 'driver_assigned'
    });

    if (!ride) {
      return res.status(404).json({
        success: false,
        message: 'Ride not found or not in correct state'
      });
    }

    ride.updateStatus('driver_arrived');
    await ride.save();

    const io = req.app.get('io');

    io.emit(`ride:${ride.rideId}:driver_arrived`, {
      rideId: ride.rideId,
      message: 'Your driver has arrived at pickup location',
      arrivedAt: ride.driverArrivedAt
    });

    // Notify customer on default namespace ride tracking channel
    io.to(`ride:${ride.rideId}`).emit('driver:arrived', {
      rideId: ride.rideId,
      message: 'Your driver has arrived at pickup location',
      arrivedAt: ride.driverArrivedAt
    });
    io.to(`ride:${ride.rideId}`).emit('ride:status-changed', {
      rideId: ride.rideId,
      status: 'driver_arrived',
      timestamp: new Date(),
      message: 'Driver has arrived at pickup location'
    });

    const requiresPayment = ride.paymentMethod !== 'cash' && ride.paymentStatus !== 'completed';
    if (requiresPayment) {
      io.emit(`ride:${ride.rideId}:payment_required`, {
        rideId: ride.rideId,
        message: 'Please complete payment before the ride starts',
        amount: ride.fare.finalAmount,
        paymentMethod: ride.paymentMethod,
        paymentIntentId: ride.paymentIntentId || null
      });
    }

    res.json({
      success: true,
      message: 'Marked as arrived at pickup',
      data: {
        rideId: ride.rideId,
        status: ride.status,
        arrivedAt: ride.driverArrivedAt,
        requiresPayment,
        paymentStatus: ride.paymentStatus
      }
    });

  } catch (error) {
    console.error('Driver arrived error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to mark arrival'
    });
  }
};

// 7. Start ride
export const startRide = async (req, res) => {
  try {
    const driverId = req.driver.id;
    const { rideId } = req.body;

    const ride = await Ride.findOne({
      rideId,
      'driver.driverId': driverId,
      status: 'driver_arrived'
    });

    if (!ride) {
      return res.status(404).json({
        success: false,
        message: 'Ride not found or not in correct state'
      });
    }

    // Payment gate for ONLINE rides:
    // If customer is paying → payment must be done before ride starts
    // If receiver is paying → skip check here, will be enforced at completeRide
    const customerMustPayFirst = ride.paymentMethod !== 'cash'
      && ride.paymentMethod !== 'wallet'
      && ride.paymentCollectedBy === 'customer'
      && ride.paymentStatus !== 'completed';

    if (customerMustPayFirst) {
      return res.status(400).json({
        success: false,
        message: 'Payment must be completed before starting the ride',
        paymentRequired: true,
        paymentStatus: ride.paymentStatus,
        paymentMethod: ride.paymentMethod,
        paymentCollectedBy: ride.paymentCollectedBy,
        paymentIntentId: ride.paymentIntentId || null,
        amount: ride.fare.finalAmount
      });
    }

    ride.updateStatus('in_progress');
    await ride.save();

    const io = req.app.get('io');

    io.emit(`ride:${ride.rideId}:started`, {
      rideId: ride.rideId,
      message: 'Your ride has started',
      startedAt: ride.rideStartedAt,
      receiver: ride.receiver
    });

    // Notify customer on default namespace ride tracking channel
    io.to(`ride:${ride.rideId}`).emit('ride:started', {
      rideId: ride.rideId,
      message: 'Your ride has started',
      startedAt: ride.rideStartedAt,
      receiver: ride.receiver
    });
    io.to(`ride:${ride.rideId}`).emit('ride:status-changed', {
      rideId: ride.rideId,
      status: 'in_progress',
      timestamp: new Date(),
      message: 'Ride is in progress'
    });

    res.json({
      success: true,
      message: 'Ride started',
      data: {
        rideId: ride.rideId,
        status: ride.status,
        startedAt: ride.rideStartedAt,
        receiver: ride.receiver,
        dropLocation: ride.dropLocation,
        dropLocations: ride.dropLocations || [],
        totalStops: ride.dropLocations?.length || 1,
        currentDropIndex: ride.currentDropIndex || 0
      }
    });

  } catch (error) {
    console.error('Start ride error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to start ride'
    });
  }
};

// 8. Complete ride
export const completeRide = async (req, res) => {
  try {
    const driverId = req.driver.id;
    const { rideId } = req.body;

    const ride = await Ride.findOne({
      rideId,
      'driver.driverId': driverId,
      status: 'in_progress'
    });

    if (!ride) {
      return res.status(404).json({
        success: false,
        message: 'Ride not found or not in correct state'
      });
    }

    const driver = await Driver.findById(driverId);
    const [driverLon, driverLat] = driver.currentLocation.coordinates;
    const [dropLon, dropLat] = ride.dropLocation.coordinates;

    const finalRouteInfo = await calculateDistanceAndDuration(
      driverLat, driverLon,
      dropLat, dropLon,
      ride.driver.vehicleType
    );

    ride.actualDistance = finalRouteInfo.distance;
    ride.actualDuration = finalRouteInfo.duration;
    ride.updateStatus('completed');

    if (ride.paymentMethod === 'cash') {
      ride.paymentStatus = 'completed';
    }

    // Block completion if receiver is supposed to pay but hasn't yet
    if (
      ride.paymentMethod !== 'cash' &&
      ride.paymentMethod !== 'wallet' &&
      ride.paymentCollectedBy === 'receiver' &&
      ride.paymentStatus !== 'completed'
    ) {
      return res.status(400).json({
        success: false,
        message: 'Receiver has not paid yet. Please collect payment from receiver before completing.',
        paymentRequired: true,
        amount: ride.fare.finalAmount,
        paymentCollectedBy: 'receiver'
      });
    }

    // ====== WALLET ACCOUNTING LOGIC ======
    const commissionAmount = ride.fare.finalAmount * 0.20;
    const driverEarning = ride.fare.finalAmount - commissionAmount;

    ride.fare.commissionAmount = commissionAmount;
    ride.fare.driverEarning = driverEarning;

    await ride.save();

    let transactionAmount = 0;
    let txType = '';
    let category = '';
    let description = '';

    if (ride.paymentMethod === 'cash') {
      // Driver has cash, so platform deducts commission from wallet
      transactionAmount = -commissionAmount;
      txType = 'debit';
      category = 'commission_due';
      description = 'Cash order commission';
    } else {
      // Platform has money (online/wallet), so platform credits earning to driver wallet
      transactionAmount = driverEarning;
      txType = 'credit';
      category = 'online_order_credit';
      description = ride.paymentMethod === 'wallet' ? 'Wallet order credit' : 'Online order credit';
    }

    const previousBalance = driver.walletBalance;
    driver.walletBalance += transactionAmount;

    // Dynamic Due Limits based on vehicle
    const dueLimits = {
      bike: 300,
      scooty: 300,
      auto: 700,
      mini_3w: 700,
      e_loader: 700,
      car: 700,
      tata_ace: 700,
      mini_truck: 700,
      truck: 700
    };
    
    const vType = (driver.vehicleType || 'bike').toLowerCase();
    const limit = dueLimits[vType] || 300;

    if (driver.walletBalance <= -limit) {
      driver.isBlocked = true;
      driver.blockReason = 'due_limit_exceeded';
    }

    driver.totalTrips += 1;
    driver.totalEarnings += ride.fare.finalAmount;
    driver.isAvailable = true;
    await driver.save();

    // ====== WALLET RIDE: Auto-deduct from customer at completion ======
    let customerWalletNew = null;
    if (ride.paymentMethod === 'wallet') {
      const customer = await Customer.findById(ride.customer.customerId);
      if (customer) {
        const custPrevBalance = customer.walletBalance;
        customer.walletBalance -= ride.fare.finalAmount;
        if (customer.walletBalance < 0) customer.walletBalance = 0; // safety floor
        await customer.save();
        customerWalletNew = customer.walletBalance;

        await WalletTransaction.create({
          userId: customer._id,
          userType: 'Customer',
          amount: -ride.fare.finalAmount,
          type: 'debit',
          transactionCategory: 'other',
          description: `Auto-payment for ride ${ride.rideId}`,
          previousBalance: custPrevBalance,
          newBalance: customer.walletBalance,
          orderId: ride._id,
          status: 'completed'
        });

        ride.paymentStatus = 'completed';
        await ride.save();
      }
    }
    // ===================================================================

    // ====== MERCHANT CASHBACK: Credit cashback to customer wallet ======
    if (ride.fare.isMerchantRide && ride.fare.cashbackAmount > 0) {
      const customer = await Customer.findById(ride.customer.customerId);
      if (customer) {
        const custPrevBalance = customer.walletBalance;
        customer.walletBalance += ride.fare.cashbackAmount;
        await customer.save();
        
        // Update customerWalletNew if it was already fetched for wallet ride
        if (customerWalletNew !== null) {
            customerWalletNew = customer.walletBalance;
        }

        await WalletTransaction.create({
          userId: customer._id,
          userType: 'Customer',
          amount: ride.fare.cashbackAmount,
          type: 'credit',
          transactionCategory: 'bonus',
          description: `Merchant cashback for ride ${ride.rideId}`,
          previousBalance: custPrevBalance,
          newBalance: customer.walletBalance,
          orderId: ride._id,
          status: 'completed'
        });
      }
    }
    // ===================================================================

    await WalletTransaction.create({
      userId: driver._id,
      userType: 'Driver',
      amount: transactionAmount,
      type: txType,
      transactionCategory: category,
      description: description,
      previousBalance: previousBalance,
      newBalance: driver.walletBalance,
      orderId: ride._id,
      status: 'completed'
    });
    // =====================================

    const io = req.app.get('io');

    const completionData = {
      rideId: ride.rideId,
      message: 'Parcel delivered successfully',
      fare: ride.fare.finalAmount,
      paymentMethod: ride.paymentMethod,
      paymentStatus: ride.paymentStatus,
      completedAt: ride.rideCompletedAt,
      actualDistance: finalRouteInfo.distanceText,
      actualDuration: finalRouteInfo.durationText,
      receiver: ride.receiver,
      // Wallet rides — show deduction info to customer
      ...(ride.paymentMethod === 'wallet' && {
        walletDeducted: ride.fare.finalAmount,
        newWalletBalance: customerWalletNew
      })
    };

    // Notify CUSTOMER — ride done + how much was deducted
    io.emit(`ride:${ride.rideId}:completed`, completionData);

    // Notify customer on default namespace ride tracking channel
    io.to(`ride:${ride.rideId}`).emit('ride:completed', completionData);
    io.to(`ride:${ride.rideId}`).emit('ride:status-changed', {
      rideId: ride.rideId,
      status: 'completed',
      timestamp: new Date(),
      message: 'Ride completed'
    });

    // Notify DRIVER — earnings credited
    io.to(`driver:${driverId}`).emit('driver:earnings_credited', {
      rideId: ride.rideId,
      message: `₹${driverEarning.toFixed(2)} credited to your wallet`,
      earning: driverEarning,
      commission: commissionAmount,
      totalFare: ride.fare.finalAmount,
      paymentMethod: ride.paymentMethod,
      walletBalance: driver.walletBalance,
      isBlocked: driver.isBlocked || false
    });

    res.json({
      success: true,
      message: 'Ride completed successfully',
      data: {
        rideId: ride.rideId,
        status: ride.status,
        fare: ride.fare.finalAmount,
        paymentMethod: ride.paymentMethod,
        paymentStatus: ride.paymentStatus,
        completedAt: ride.rideCompletedAt,
        actualDistance: finalRouteInfo.distanceText,
        actualDuration: finalRouteInfo.durationText,
        receiver: ride.receiver
      }
    });

  } catch (error) {
    console.error('Complete ride error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to complete ride'
    });
  }
};

// 9. Cancel ride
// ==================== CANCEL RIDE - NO PENALTIES ====================
// controllers/rideController.js - Updated cancelRide function

// ==================== CANCEL RIDE - FIXED VERSION ====================
export const cancelRide = async (req, res) => {
  try {
    const rideId = req.params.rideId || req.body.rideId;
    const reason = req.body.reason || req.body.cancelReason;

    // FIX: Properly determine user type and ID from request
    let userType = null;
    let userId = null;

    // Check if it's a customer (has customerId from customerAuthMiddleware)
    if (req.customerId) {
      userType = 'customer';
      userId = req.customerId;
      console.log('👤 Cancelling as CUSTOMER:', userId);
    }
    // Check if it's a driver (has driver from driverAuthMiddleware)
    else if (req.driver && req.driver.id) {
      userType = 'driver';
      userId = req.driver.id;
      console.log('👤 Cancelling as DRIVER:', userId);
    }
    // Check if it's admin (has adminId from authMiddleware)
    else if (req.adminId) {
      userType = 'admin';
      userId = req.adminId;
      console.log('👤 Cancelling as ADMIN:', userId);
    }

    if (!userType) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required. Please login as customer or driver.'
      });
    }

    if (!rideId) {
      return res.status(400).json({
        success: false,
        message: 'Ride ID is required'
      });
    }

    // Find ride with proper population
    const ride = await Ride.findOne({ rideId })
      .populate('customer.customerId')
      .populate('driver.driverId');

    if (!ride) {
      return res.status(404).json({
        success: false,
        message: `Ride with ID ${rideId} not found`
      });
    }

    console.log('🚗 Ride found:', {
      rideId: ride.rideId,
      status: ride.status,
      customerId: ride.customer?.customerId?._id,
      driverId: ride.driver?.driverId?._id
    });

    // Check if ride can be cancelled
    const cancellableStatuses = ['requested', 'searching', 'driver_assigned', 'driver_arrived', 'in_progress', 'no_drivers'];
    if (!cancellableStatuses.includes(ride.status)) {
      return res.status(400).json({
        success: false,
        message: `Ride cannot be cancelled. Current status: ${ride.status}. Only ${cancellableStatuses.join(', ')} rides can be cancelled.`
      });
    }

    // Authorization check based on user type
    let isAuthorized = false;

    if (userType === 'customer') {
      const rideCustomerId = ride.customer?.customerId?._id?.toString() || ride.customer?.customerId?.toString();
      if (rideCustomerId === userId.toString()) {
        isAuthorized = true;
        console.log('✅ Customer authorized to cancel');
      } else {
        console.log('❌ Customer not authorized:', { rideCustomerId, userId });
      }
    }
    else if (userType === 'driver') {
      const rideDriverId = ride.driver?.driverId?._id?.toString() || ride.driver?.driverId?.toString();
      if (rideDriverId === userId.toString()) {
        isAuthorized = true;
        console.log('✅ Driver authorized to cancel');
      } else {
        console.log('❌ Driver not authorized:', { rideDriverId, userId });
      }
    }
    else if (userType === 'admin') {
      isAuthorized = true;
      console.log('✅ Admin authorized to cancel');
    }

    if (!isAuthorized) {
      return res.status(403).json({
        success: false,
        message: `Not authorized to cancel this ride. You are logged in as ${userType} but this ride belongs to ${ride.customer?.customerId?._id === userId ? 'you' : 'another user'}.`
      });
    }

    // NO CANCELLATION FEE - Simple cancellation
    const io = req.app.get('io');

    // Update ride status
    ride.status = 'cancelled';
    ride.cancelledAt = new Date();
    ride.cancelledBy = userType;
    ride.cancellationReason = reason || (userType === 'customer' ? 'Cancelled by customer' : (userType === 'driver' ? 'Cancelled by driver' : 'Cancelled by admin'));
    ride.cancellationFee = 0; // No fee

    // Handle payment refund if applicable
    let refundAmount = 0;
    let paymentRefundNeeded = false;

    if (ride.paymentMethod !== 'cash' && ride.paymentStatus === 'completed') {
      // Full refund for prepaid rides
      refundAmount = ride.fare.finalAmount;
      paymentRefundNeeded = true;
      ride.paymentStatus = 'refunded';
      ride.refundAmount = refundAmount;
      ride.refundProcessedAt = new Date();
    }

    await ride.save();
    console.log('✅ Ride cancelled and saved');

    // Update driver availability
    if (ride.driver && ride.driver.driverId) {
      const driver = await Driver.findById(ride.driver.driverId);
      if (driver) {
        driver.isAvailable = true;
        await driver.save();
        console.log('✅ Driver availability updated:', driver._id);
      }
    }

    // Prepare cancellation data for socket emission
    const cancellationData = {
      rideId: ride.rideId,
      cancelledBy: userType,
      reason: ride.cancellationReason,
      timestamp: new Date(),
      message: `Ride cancelled by ${userType}`,
      cancellationFee: 0
    };

    // Add refund info if applicable
    if (paymentRefundNeeded) {
      cancellationData.refundAmount = refundAmount;
      cancellationData.message = `Ride cancelled. Full refund of ₹${refundAmount} will be processed.`;
    }

    // ==================== SOCKET EMISSIONS ====================

    // 1. Notify customer (if they didn't cancel)
    if (ride.customer && ride.customer.customerId && userType !== 'customer') {
      const customerId = ride.customer.customerId._id || ride.customer.customerId;
      io.to(`customer:${customerId}`).emit('ride:cancelled', cancellationData);
      console.log(`📡 Cancellation notified to customer: ${customerId}`);
    }

    // 2. Notify driver (if they didn't cancel and driver exists)
    if (ride.driver && ride.driver.driverId && userType !== 'driver') {
      const driverId = ride.driver.driverId._id || ride.driver.driverId;
      io.to(`driver:${driverId}`).emit('ride:cancelled', cancellationData);
      console.log(`📡 Cancellation notified to driver: ${driverId}`);
    }

    // 3. Notify all drivers who were previously notified about this ride
    if (ride.driversNotified && ride.driversNotified.length > 0) {
      ride.driversNotified.forEach(notification => {
        if (notification.driverId && notification.driverId.toString() !== userId) {
          io.to(`driver:${notification.driverId}`).emit('ride:cancelled', {
            ...cancellationData,
            message: `Ride ${ride.rideId} has been cancelled`
          });
          console.log(`📡 Cancellation notified to previously notified driver: ${notification.driverId}`);
        }
      });
    }

    // 4. Notify ride tracking namespace (for real-time updates)
    const rideTrackingNsp = io.of('/ride-tracking');
    if (rideTrackingNsp) {
      rideTrackingNsp.to(`ride:${ride.rideId}`).emit('ride:cancelled', cancellationData);
      console.log(`📡 Cancellation emitted to ride tracking room: ride:${ride.rideId}`);
    }

    // Notify customer/driver on default namespace ride tracking channel
    io.to(`ride:${ride.rideId}`).emit('ride:cancelled', cancellationData);
    io.to(`ride:${ride.rideId}`).emit('ride:status-changed', {
      rideId: ride.rideId,
      status: 'cancelled',
      timestamp: new Date(),
      message: `Ride cancelled by ${userType}`
    });

    // 5. Notify admin for monitoring
    io.of('/admin').to('admin-room').emit('ride:cancelled', {
      ...cancellationData,
      rideDetails: {
        customerName: ride.customer?.name,
        driverName: ride.driver?.name,
        pickupLocation: ride.pickupLocation?.address,
        dropLocation: ride.dropLocation?.address,
        fare: ride.fare?.total
      }
    });
    console.log(`📡 Cancellation notified to admin`);

    // Prepare response data
    const responseData = {
      rideId: ride.rideId,
      status: ride.status,
      cancelledAt: ride.cancelledAt,
      cancelledBy: ride.cancelledBy,
      cancellationReason: ride.cancellationReason,
      message: `Ride cancelled successfully`
    };

    // Add refund info if applicable
    if (paymentRefundNeeded) {
      responseData.refundAmount = refundAmount;
      responseData.paymentStatus = ride.paymentStatus;
      responseData.message = `Ride cancelled successfully. Full refund of ₹${refundAmount} will be processed.`;
    }

    res.json({
      success: true,
      message: responseData.message,
      data: responseData
    });

  } catch (error) {
    console.error('❌ Cancel ride error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to cancel ride'
    });
  }
};

// 10. Update driver location during ride
export const updateRideLocation = async (req, res) => {
  try {
    const driverId = req.driver.id;
    const { rideId, latitude, longitude } = req.body;

    const ride = await Ride.findOne({
      rideId,
      'driver.driverId': driverId,
      status: { $in: ['driver_assigned', 'driver_arrived', 'in_progress'] }
    });

    if (!ride) {
      return res.status(404).json({
        success: false,
        message: 'Active ride not found'
      });
    }

    ride.tracking.push({
      timestamp: new Date(),
      location: {
        type: 'Point',
        coordinates: [longitude, latitude]
      }
    });

    await ride.save();

    await Driver.findByIdAndUpdate(driverId, {
      currentLocation: {
        type: 'Point',
        coordinates: [longitude, latitude]
      },
      lastActive: new Date()
    });

    let eta = null;
    let etaText = null;

    if (ride.status === 'driver_assigned' || ride.status === 'driver_arrived') {
      const etaInfo = await calculateDistanceAndDuration(
        latitude, longitude,
        ride.pickupLocation.coordinates[1], ride.pickupLocation.coordinates[0],
        ride.driver.vehicleType
      );
      eta = etaInfo.duration;
      etaText = etaInfo.durationText;
    } else if (ride.status === 'in_progress') {
      const etaInfo = await calculateDistanceAndDuration(
        latitude, longitude,
        ride.dropLocation.coordinates[1], ride.dropLocation.coordinates[0],
        ride.driver.vehicleType
      );
      eta = etaInfo.duration;
      etaText = etaInfo.durationText;

      const distanceToDropKm = calculateHaversineDistance(
        latitude, longitude,
        ride.dropLocation.coordinates[1],
        ride.dropLocation.coordinates[0]
      );

      const NEAR_DESTINATION_THRESHOLD_KM = 0.1;

      if (distanceToDropKm <= NEAR_DESTINATION_THRESHOLD_KM && !ride.nearDestination) {
        ride.nearDestination = true;
        await ride.save();

        const io = req.app.get('io');
        io.emit(`ride:${ride.rideId}:near_destination`, {
          rideId: ride.rideId,
          message: 'You are within 100m of the drop location. You can now complete the ride.',
          distanceToDropMeters: Math.round(distanceToDropKm * 1000),
          dropLocation: ride.dropLocation,
          receiver: ride.receiver
        });
      }
    }

    const io = req.app.get('io');
    io.emit(`ride:${ride.rideId}:location_update`, {
      rideId: ride.rideId,
      location: [longitude, latitude],
      timestamp: new Date(),
      eta,
      etaText,
      nearDestination: ride.nearDestination || false
    });

    res.json({
      success: true,
      message: 'Location updated',
      data: {
        rideId: ride.rideId,
        location: [longitude, latitude],
        eta,
        etaText,
        nearDestination: ride.nearDestination || false
      }
    });

  } catch (error) {
    console.error('Update ride location error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to update location'
    });
  }
};

// 11. Track ride
export const trackRide = async (req, res) => {
  try {
    const customerId = req.customerId;
    const { rideId } = req.params;
    console.log(rideId);
    const ride = await Ride.findOne({
      rideId,
      'customer.customerId': customerId,
      status: { $in: ['driver_assigned', 'driver_arrived', 'in_progress'] }
    }).populate('driver.driverId');

    console.log(ride);

    if (!ride) {
      return res.status(404).json({
        success: false,
        message: 'Active ride not found'
      });
    }

    const driver = ride.driver.driverId;
    const driverLocation = driver?.currentLocation?.coordinates || null;

    let eta = null;
    let etaText = null;
    let distanceToTarget = null;
    let distanceToTargetText = null;

    if (driverLocation && (ride.status === 'driver_assigned' || ride.status === 'driver_arrived')) {
      const etaInfo = await calculateDistanceAndDuration(
        driverLocation[1], driverLocation[0],
        ride.pickupLocation.coordinates[1], ride.pickupLocation.coordinates[0],
        driver?.vehicleType
      );
      eta = etaInfo.duration;
      etaText = etaInfo.durationText;
      distanceToTarget = etaInfo.distance;
      distanceToTargetText = etaInfo.distanceText;
    } else if (driverLocation && ride.status === 'in_progress') {
      // For multi-drop: calculate ETA to current drop location
      const currentIdx = ride.currentDropIndex || 0;
      const targetDrop = (ride.dropLocations && ride.dropLocations.length > 0)
        ? ride.dropLocations[Math.min(currentIdx, ride.dropLocations.length - 1)]
        : ride.dropLocation;
      const etaInfo = await calculateDistanceAndDuration(
        driverLocation[1], driverLocation[0],
        targetDrop.coordinates[1], targetDrop.coordinates[0],
        driver?.vehicleType
      );
      eta = etaInfo.duration;
      etaText = etaInfo.durationText;
      distanceToTarget = etaInfo.distance;
      distanceToTargetText = etaInfo.distanceText;
    }

    res.json({
      success: true,
      data: {
        rideId: ride.rideId,
        status: ride.status,
        driverLocation,
        eta,
        etaText,
        distanceToTarget,
        distanceToTargetText,
        pickupLocation: ride.pickupLocation,
        dropLocation: ride.dropLocation,
        dropLocations: ride.dropLocations || [],
        totalStops: ride.dropLocations?.length || 1,
        currentDropIndex: ride.currentDropIndex || 0,
        legDistances: ride.legDistances || [],
        driver: {
          name: ride.driver.name,
          vehicleType: ride.driver.vehicleType,
          vehicleNumber: ride.driver.vehicleNumber,
          rating: ride.driver.rating,
          phone: ride.driver.phone
        },
        tracking: ride.tracking.slice(-10)
      }
    });

  } catch (error) {
    console.error('Track ride error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to track ride'
    });
  }
};

// 12. Get ride status
export const getRideStatus = async (req, res) => {
  try {
    const { rideId } = req.params;
    const userId = req.customerId || req.driver?.id;
    const userType = req.customerId ? 'customer' : (req.driver ? 'driver' : null);

    const ride = await Ride.findOne({ rideId });

    if (!ride) {
      return res.status(404).json({
        success: false,
        message: 'Ride not found'
      });
    }

    if (userType === 'customer' && ride.customer.customerId.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view this ride'
      });
    }

    if (userType === 'driver' && ride.driver?.driverId?.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view this ride'
      });
    }

    res.json({
      success: true,
      data: {
        rideId: ride.rideId,
        status: ride.status,
        driver: ride.driver ? {
          name: ride.driver.name,
          vehicleType: ride.driver.vehicleType,
          vehicleNumber: ride.driver.vehicleNumber,
          rating: ride.driver.rating,
          phone: ride.driver.phone
        } : null,
        customer: ride.customer ? {
          name: ride.customer.name,
          phone: ride.customer.phone,
          rating: ride.customer.rating
        } : null,
        pickupLocation: ride.pickupLocation,
        dropLocation: ride.dropLocation,
        dropLocations: ride.dropLocations || [],
        totalStops: ride.dropLocations?.length || 1,
        legDistances: ride.legDistances || [],
        currentDropIndex: ride.currentDropIndex || 0,
        fare: ride.fare,
        distance: ride.distance,
        distanceText: ride.routeInfo?.distanceText,
        duration: ride.duration,
        durationText: ride.routeInfo?.durationText,
        paymentMethod: ride.paymentMethod,
        paymentStatus: ride.paymentStatus,
        driverETA: ride.driverETA,
        timestamps: {
          requestedAt: ride.requestedAt,
          driverAssignedAt: ride.driverAssignedAt,
          driverArrivedAt: ride.driverArrivedAt,
          rideStartedAt: ride.rideStartedAt,
          rideCompletedAt: ride.rideCompletedAt,
          cancelledAt: ride.cancelledAt
        }
      }
    });

  } catch (error) {
    console.error('Get ride status error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to get ride status'
    });
  }
};

// 13. Rate driver
export const rateDriver = async (req, res) => {
  try {
    const customerId = req.customerId;
    const { rideId } = req.params;
    const { rating, review } = req.body;

    const ride = await Ride.findOne({
      rideId,
      'customer.customerId': customerId,
      status: 'completed'
    });

    if (!ride) {
      return res.status(404).json({
        success: false,
        message: 'Completed ride not found'
      });
    }

    if (ride.customerRating?.givenAt) {
      return res.status(400).json({
        success: false,
        message: 'You have already rated this driver'
      });
    }

    ride.customerRating = {
      rating,
      review,
      givenAt: new Date()
    };

    await ride.save();

    const driverRides = await Ride.find({
      'driver.driverId': ride.driver.driverId,
      'customerRating.rating': { $exists: true }
    });

    const avgRating = driverRides.reduce((acc, r) => acc + r.customerRating.rating, 0) / driverRides.length;

    await Driver.findByIdAndUpdate(ride.driver.driverId, {
      rating: Math.round(avgRating * 10) / 10
    });

    res.json({
      success: true,
      message: 'Driver rated successfully',
      data: {
        rating,
        driverRating: avgRating
      }
    });

  } catch (error) {
    console.error('Rate driver error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to rate driver'
    });
  }
};

// 14. Rate customer
export const rateCustomer = async (req, res) => {
  try {
    const driverId = req.driver.id;
    const { rideId } = req.params;
    const { rating, review } = req.body;

    const ride = await Ride.findOne({
      rideId,
      'driver.driverId': driverId,
      status: 'completed'
    });

    if (!ride) {
      return res.status(404).json({
        success: false,
        message: 'Completed ride not found'
      });
    }

    if (ride.driverRating?.givenAt) {
      return res.status(400).json({
        success: false,
        message: 'You have already rated this customer'
      });
    }

    ride.driverRating = {
      rating,
      review,
      givenAt: new Date()
    };

    await ride.save();

    const customerRides = await Ride.find({
      'customer.customerId': ride.customer.customerId,
      'driverRating.rating': { $exists: true }
    });

    const avgRating = customerRides.reduce((acc, r) => acc + r.driverRating.rating, 0) / customerRides.length;

    await Customer.findByIdAndUpdate(ride.customer.customerId, {
      rating: Math.round(avgRating * 10) / 10
    });

    res.json({
      success: true,
      message: 'Customer rated successfully',
      data: {
        rating,
        customerRating: avgRating
      }
    });

  } catch (error) {
    console.error('Rate customer error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to rate customer'
    });
  }
};

// 15. Get customer ride history
export const getCustomerRideHistory = async (req, res) => {
  try {
    const customerId = req.customerId;
    const { page = 1, limit = 10, status } = req.query;

    const query = { 'customer.customerId': customerId };
    if (status) query.status = status;

    const rides = await Ride.find(query)
      .sort({ requestedAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .select('-tracking -driversNotified');

    const total = await Ride.countDocuments(query);

    const totals = await Ride.aggregate([
      { $match: { 'customer.customerId': customerId, status: 'completed' } },
      {
        $group: {
          _id: null,
          totalSpent: { $sum: '$fare.finalAmount' },
          totalRides: { $sum: 1 },
          averageRating: { $avg: '$driverRating.rating' }
        }
      }
    ]);

    res.json({
      success: true,
      data: {
        rides: rides.map(ride => ({
          ...ride.toObject(),
          distanceText: ride.routeInfo?.distanceText,
          durationText: ride.routeInfo?.durationText
        })),
        stats: {
          totalRides: totals[0]?.totalRides || 0,
          totalSpent: totals[0]?.totalSpent || 0,
          averageRating: totals[0]?.averageRating || 0
        },
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });

  } catch (error) {
    console.error('Get customer ride history error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to get ride history'
    });
  }
};

// 16. Get driver ride history
export const getDriverRideHistory = async (req, res) => {
  try {
    const driverId = req.driver.id;
    const { page = 1, limit = 10, status } = req.query;

    const query = { 'driver.driverId': driverId };
    if (status) query.status = status;

    const rides = await Ride.find(query)
      .sort({ requestedAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .select('-tracking -driversNotified');

    const total = await Ride.countDocuments(query);

    const earnings = await Ride.aggregate([
      { $match: { 'driver.driverId': driverId, status: 'completed' } },
      {
        $group: {
          _id: null,
          totalEarnings: { $sum: '$fare.finalAmount' },
          totalRides: { $sum: 1 },
          averageRating: { $avg: '$customerRating.rating' }
        }
      }
    ]);

    res.json({
      success: true,
      data: {
        rides: rides.map(ride => ({
          ...ride.toObject(),
          distanceText: ride.routeInfo?.distanceText,
          durationText: ride.routeInfo?.durationText
        })),
        stats: {
          totalRides: earnings[0]?.totalRides || 0,
          totalEarnings: earnings[0]?.totalEarnings || 0,
          averageRating: earnings[0]?.averageRating || 0
        },
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });

  } catch (error) {
    console.error('Get driver ride history error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to get ride history'
    });
  }
};

// Add this to your rideController.js
export const updateDriverLocation = async (req, res) => {
  try {
    const driverId = req.driver.id;
    const { latitude, longitude } = req.body;
    console.log(driverId, latitude, longitude);

    if (!latitude || !longitude) {
      return res.status(400).json({
        success: false,
        message: 'Latitude and longitude are required'
      });
    }

    // Update driver location in database
    const driver = await Driver.findByIdAndUpdate(
      driverId,
      {
        currentLocation: {
          type: 'Point',
          coordinates: [parseFloat(longitude), parseFloat(latitude)]
        },
        lastActive: new Date()
      },
      { new: true }
    );

    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found'
      });
    }

    // Broadcast location update to all connected clients in nearby area
    const io = req.app.get('io');

    // Emit to all drivers in the area (for other drivers to see)
    io.emit('driver:location_updated', {
      driverId: driver._id,
      name: driver.name,
      lat: latitude,
      lng: longitude,
      vehicleType: driver.vehicleType,
      vehicleNumber: driver.vehicleNumber,
      rating: driver.rating,
      isOnline: driver.isOnline,
      isAvailable: driver.isAvailable,
      timestamp: new Date().toISOString()
    });

    // Also emit to specific room for customers tracking this driver
    if (driver.currentRide) {
      io.to(`ride:${driver.currentRide}`).emit('driver:location_update', {
        rideId: driver.currentRide,
        lat: latitude,
        lng: longitude,
        timestamp: new Date().toISOString()
      });
    }

    res.json({
      success: true,
      message: 'Location updated successfully',
      data: {
        lat: latitude,
        lng: longitude,
        lastActive: driver.lastActive
      }
    });

  } catch (error) {
    console.error('Update driver location error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to update location'
    });
  }
};

// 17. Get nearby drivers
export const getNearbyDrivers = async (req, res) => {
  try {
    const { latitude, longitude, radius = 5, vehicleType } = req.query;

    if (!latitude || !longitude) {
      return res.status(400).json({
        success: false,
        message: 'Latitude and longitude are required'
      });
    }

    const queryConditions = {
      isOnline: true,
      isAvailable: true,
      isBlocked: false
    };

    if (vehicleType) {
      queryConditions.vehicleType = vehicleType;
    }

    const drivers = await Driver.aggregate([
      {
        $geoNear: {
          near: {
            type: 'Point',
            coordinates: [parseFloat(longitude), parseFloat(latitude)]
          },
          distanceField: 'distance',
          maxDistance: radius * 1000,
          spherical: true,
          query: queryConditions
        }
      },
      { $limit: 20 },
      {
        $project: {
          name: 1,
          vehicleType: 1,
          vehicleNumber: 1,
          rating: 1,
          currentLocation: 1,
          distance: 1,
          isOnline: 1,
          isAvailable: 1
        }
      }
    ]);

    const driversWithDetails = await Promise.all(drivers.map(async (driver) => {
      const [driverLon, driverLat] = driver.currentLocation.coordinates;
      const etaInfo = await calculateDistanceAndDuration(
        driverLat, driverLon,
        parseFloat(latitude), parseFloat(longitude),
        driver.vehicleType
      );

      return {
        driverId: driver._id,
        name: driver.name,
        vehicleType: driver.vehicleType,
        vehicleNumber: driver.vehicleNumber,
        lat: driverLat,
        lng: driverLon,
        rating: driver.rating,
        distance: driver.distance / 1000,
        distanceText: `${(driver.distance / 1000).toFixed(1)} km`,
        eta: etaInfo.duration,
        etaText: etaInfo.durationText,
        isOnline: driver.isOnline,
        isAvailable: driver.isAvailable
      };
    }));

    driversWithDetails.sort((a, b) => a.distance - b.distance);

    res.json({
      success: true,
      data: {
        count: driversWithDetails.length,
        drivers: driversWithDetails,
        searchRadius: radius
      }
    });

  } catch (error) {
    console.error('Get nearby drivers error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to get nearby drivers'
    });
  }
};

// 18. Calculate fare estimate - UPDATED with multi-drop support
export const calculateFareEstimate = async (req, res) => {
  try {
    const { pickupLat, pickupLon, dropLat, dropLon, vehicleType = 'car', drops } = req.query;

    // Support multi-drop: drops = JSON array of {lat, lon} or use single dropLat/dropLon
    let dropPoints = [];
    if (drops) {
      try {
        dropPoints = JSON.parse(drops);
      } catch (e) {
        return res.status(400).json({
          success: false,
          message: 'Invalid drops format. Expected JSON array of {lat, lon}'
        });
      }
    } else if (dropLat && dropLon) {
      dropPoints = [{ lat: dropLat, lon: dropLon }];
    }

    if (!pickupLat || !pickupLon || dropPoints.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Please provide pickup coordinates and at least one drop location'
      });
    }

    if (dropPoints.length > 4) {
      return res.status(400).json({
        success: false,
        message: 'Maximum 4 drop locations allowed'
      });
    }

    // Calculate leg-by-leg distances
    const legDistances = [];
    let totalDistance = 0;
    let totalDuration = 0;
    let prevLat = parseFloat(pickupLat);
    let prevLon = parseFloat(pickupLon);

    for (let i = 0; i < dropPoints.length; i++) {
      const dLat = parseFloat(dropPoints[i].lat);
      const dLon = parseFloat(dropPoints[i].lon);
      const legInfo = await calculateDistanceAndDuration(
        prevLat, prevLon,
        dLat, dLon,
        vehicleType
      );

      legDistances.push({
        leg: i + 1,
        from: i === 0 ? 'Pickup' : `Drop ${i}`,
        to: `Drop ${i + 1}`,
        distance: legInfo.distance,
        distanceText: legInfo.distanceText,
        duration: legInfo.duration,
        durationText: legInfo.durationText
      });

      totalDistance += legInfo.distance;
      totalDuration += legInfo.duration;
      prevLat = dLat;
      prevLon = dLon;
    }

    totalDistance = parseFloat(totalDistance.toFixed(2));

    // Calculate fare based on total cumulative distance
    const fare = await Ride.calculateFare(totalDistance, vehicleType);

    const nearbyDriversResult = await Driver.aggregate([
      {
        $geoNear: {
          near: {
            type: 'Point',
            coordinates: [parseFloat(pickupLon), parseFloat(pickupLat)]
          },
          distanceField: 'distance',
          maxDistance: 5 * 1000,
          spherical: true,
          query: {
            isOnline: true,
            isAvailable: true,
            isBlocked: false
          }
        }
      },
      { $count: 'count' }
    ]);

    const nearbyDriversCount = nearbyDriversResult[0]?.count || 0;

    res.json({
      success: true,
      data: {
        totalStops: dropPoints.length,
        distance: totalDistance,
        distanceText: `${totalDistance.toFixed(1)} km`,
        duration: totalDuration,
        durationText: `${totalDuration} mins`,
        legDistances,
        fare: {
          distanceFare: fare.distanceFare,
          total: fare.total,
          breakdown: {
            ...fare.breakdown,
            legs: legDistances.map(leg => ({
              leg: `${leg.from} → ${leg.to}`,
              distance: leg.distanceText,
              duration: leg.durationText
            })),
            totalDistance: `${totalDistance.toFixed(1)} km`,
            totalFare: `₹${fare.total}`
          }
        },
        vehicleType,
        nearbyDrivers: nearbyDriversCount,
        estimatedArrival: totalDuration + 5
      }
    });

  } catch (error) {
    console.error('Calculate fare error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to calculate fare'
    });
  }
};
// Add these functions to your existing driverController.js

// Update driver location with socket broadcast
export const updateDriverLocationWithSocket = async (req, res) => {
  try {
    const driverId = req.driver.id;
    const { latitude, longitude, rideId } = req.body;
    const io = req.app.get('io');

    if (!latitude || !longitude) {
      return res.status(400).json({
        success: false,
        message: 'Latitude and longitude are required'
      });
    }

    // Update driver location in database
    const driver = await Driver.findByIdAndUpdate(
      driverId,
      {
        currentLocation: {
          type: 'Point',
          coordinates: [parseFloat(longitude), parseFloat(latitude)]
        },
        lastActive: new Date()
      },
      { new: true }
    );

    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found'
      });
    }

    // Emit location update through socket
    const locationData = {
      driverId,
      latitude,
      longitude,
      rideId: rideId || null,
      timestamp: new Date(),
      driverDetails: {
        name: driver.name,
        vehicleType: driver.vehicleType,
        vehicleNumber: driver.vehicleNumber,
        rating: driver.rating
      }
    };

    // If on a ride, broadcast to ride room
    if (rideId) {
      io.to(`ride:${rideId}`).emit('driver:location-updated', locationData);

      // Also emit to ride tracking namespace
      const rideTrackingNsp = io.of('/ride-tracking');
      rideTrackingNsp.to(`ride:${rideId}`).emit('driver:location-updated', locationData);
    } else {
      // Broadcast to nearby customers looking for rides
      const nearbyCustomers = await findNearbyCustomers(latitude, longitude, 5);
      nearbyCustomers.forEach(customer => {
        io.to(`customer:${customer.customerId}`).emit('driver:nearby', {
          driverId,
          location: { latitude, longitude },
          driverDetails: locationData.driverDetails,
          distance: customer.distance
        });
      });
    }

    res.json({
      success: true,
      message: 'Location updated successfully',
      data: {
        lat: latitude,
        lng: longitude,
        lastActive: driver.lastActive
      }
    });

  } catch (error) {
    console.error('Update driver location error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to update location'
    });
  }
};

// Helper function to find nearby customers
async function findNearbyCustomers(latitude, longitude, radius) {
  try {
    // Find rides that are searching for drivers
    const Ride = (await import('../models/Ride.js')).default;
    const searchingRides = await Ride.find({
      status: 'searching',
      'customer.customerId': { $exists: true }
    }).populate('customer.customerId');

    const nearbyCustomers = [];

    for (const ride of searchingRides) {
      const [pickupLon, pickupLat] = ride.pickupLocation.coordinates;
      const distance = calculateDistance(latitude, longitude, pickupLat, pickupLon);

      if (distance <= radius) {
        nearbyCustomers.push({
          customerId: ride.customer.customerId,
          rideId: ride.rideId,
          distance,
          pickupLocation: ride.pickupLocation
        });
      }
    }

    return nearbyCustomers;
  } catch (error) {
    console.error('Error finding nearby customers:', error);
    return [];
  }
}



// Add these functions to your existing rideController.js

// Enhanced ride acceptance with socket
export const acceptRideWithSocket = async (req, res) => {
  try {
    const driverId = req.driver.id;
    const { rideId, driverLocation } = req.body;
    const io = req.app.get('io');

    const driver = await Driver.findById(driverId);
    if (!driver || !driver.isOnline || !driver.isAvailable) {
      return res.status(400).json({
        success: false,
        message: 'You must be online and available to accept rides'
      });
    }

    const ride = await Ride.findOne({
      rideId,
      status: { $in: ['searching', 'no_drivers'] }
    });
    if (!ride) {
      return res.status(404).json({
        success: false,
        message: 'Ride not found or already assigned'
      });
    }

    // Calculate distance to pickup
    const [pickupLon, pickupLat] = ride.pickupLocation.coordinates;
    const distanceToPickup = calculateDistance(
      driverLocation.latitude,
      driverLocation.longitude,
      pickupLat,
      pickupLon
    );

    const MAX_ACCEPTABLE_DISTANCE = 5; // km
    if (distanceToPickup > MAX_ACCEPTABLE_DISTANCE) {
      return res.status(400).json({
        success: false,
        message: `You are too far from pickup location (${distanceToPickup.toFixed(1)}km)`
      });
    }

    // Calculate ETA
    const speed = getAverageSpeed(driver.vehicleType);
    const etaToPickup = Math.ceil((distanceToPickup / speed) * 60);

    // Update ride
    ride.driver = {
      driverId: driver._id,
      name: driver.name,
      phone: driver.phone,
      vehicleType: driver.vehicleType,
      vehicleNumber: driver.vehicleNumber,
      rating: driver.rating || 0
    };
    ride.updateStatus('driver_assigned');
    ride.driverETA = {
      distance: distanceToPickup,
      duration: etaToPickup,
      distanceText: `${distanceToPickup.toFixed(1)} km`,
      durationText: `${etaToPickup} mins`
    };
    await ride.save();

    // Update driver status
    driver.isAvailable = false;
    await driver.save();

    // Emit socket events
    const acceptanceData = {
      rideId: ride.rideId,
      driver: {
        driverId: driver._id,
        name: driver.name,
        phone: driver.phone,
        vehicleType: driver.vehicleType,
        vehicleNumber: driver.vehicleNumber,
        rating: driver.rating,
        location: driverLocation
      },
      eta: etaToPickup,
      etaText: `${etaToPickup} mins`,
      pickupLocation: ride.pickupLocation,
      dropLocation: ride.dropLocation,
      dropLocations: ride.dropLocations || [],
      totalStops: ride.dropLocations?.length || 1,
      fare: ride.fare.total
    };

    // Notify customer
    io.to(`customer:${ride.customer.customerId}`).emit('ride:accepted', acceptanceData);

    // Notify customer on the ride tracking channel (default namespace room)
    io.to(`ride:${ride.rideId}`).emit('ride:accepted', acceptanceData);
    io.to(`ride:${ride.rideId}`).emit('ride:status-changed', {
      rideId: ride.rideId,
      status: 'driver_assigned',
      driver: acceptanceData.driver,
      eta: etaToPickup,
      etaText: `${etaToPickup} mins`,
      timestamp: new Date(),
      message: 'Driver assigned to your ride'
    });

    // Also emit to ride tracking namespace
    const rideTrackingNsp = io.of('/ride-tracking');
    rideTrackingNsp.to(`ride:${ride.rideId}`).emit('ride:accepted', acceptanceData);

    // Notify other drivers that this ride is taken
    ride.driversNotified?.forEach(d => {
      if (d.driverId.toString() !== driverId) {
        io.to(`driver:${d.driverId}`).emit('ride:taken', {
          rideId: ride.rideId,
          message: 'This ride was accepted by another driver'
        });
      }
    });

    res.json({
      success: true,
      message: 'Ride accepted successfully',
      data: {
        rideId: ride.rideId,
        customer: ride.customer,
        pickupLocation: ride.pickupLocation,
        dropLocation: ride.dropLocation,
        dropLocations: ride.dropLocations || [],
        totalStops: ride.dropLocations?.length || 1,
        eta: etaToPickup,
        etaText: `${etaToPickup} mins`,
        fare: ride.fare.total
      }
    });

  } catch (error) {
    console.error('Accept ride error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to accept ride'
    });
  }
};

// Get driver location for tracking (for customers)
export const getDriverLocationForTracking = async (req, res) => {
  try {
    const { rideId } = req.params;
    const customerId = req.customerId;

    const ride = await Ride.findOne({ rideId, 'customer.customerId': customerId });

    if (!ride) {
      return res.status(404).json({
        success: false,
        message: 'Ride not found'
      });
    }

    if (!ride.driver?.driverId) {
      return res.status(404).json({
        success: false,
        message: 'No driver assigned yet'
      });
    }

    const driver = await Driver.findById(ride.driver.driverId);

    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found'
      });
    }

    const [lng, lat] = driver.currentLocation.coordinates;

    // Calculate ETA based on ride status
    let eta = null;
    let etaText = null;
    let remainingDistance = null;

    if (ride.status === 'driver_assigned' || ride.status === 'driver_arrived') {
      const [pickupLon, pickupLat] = ride.pickupLocation.coordinates;
      const distance = calculateDistance(lat, lng, pickupLat, pickupLon);
      const speed = getAverageSpeed(driver.vehicleType);
      eta = Math.ceil((distance / speed) * 60);
      etaText = `${eta} mins`;
      remainingDistance = distance;
    } else if (ride.status === 'in_progress') {
      // For multi-drop: calculate ETA to current drop location
      const currentIdx = ride.currentDropIndex || 0;
      const targetDrop = (ride.dropLocations && ride.dropLocations.length > 0)
        ? ride.dropLocations[Math.min(currentIdx, ride.dropLocations.length - 1)]
        : ride.dropLocation;
      const [dropLon, dropLat] = targetDrop.coordinates;
      const distance = calculateDistance(lat, lng, dropLat, dropLon);
      const speed = getAverageSpeed(driver.vehicleType);
      eta = Math.ceil((distance / speed) * 60);
      etaText = `${eta} mins`;
      remainingDistance = distance;
    }

    res.json({
      success: true,
      data: {
        driverId: driver._id,
        name: driver.name,
        phone: driver.phone,
        vehicleType: driver.vehicleType,
        vehicleNumber: driver.vehicleNumber,
        rating: driver.rating,
        location: { lat, lng },
        eta,
        etaText,
        remainingDistance,
        rideStatus: ride.status,
        currentDropIndex: ride.currentDropIndex || 0,
        totalStops: ride.dropLocations?.length || 1
      }
    });

  } catch (error) {
    console.error('Get driver location error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to get driver location'
    });
  }
};

// Get ride tracking info
export const getRideTrackingInfo = async (req, res) => {
  try {
    const { rideId } = req.params;
    const userId = req.customerId || req.driver?.id;

    const ride = await Ride.findOne({ rideId });

    if (!ride) {
      return res.status(404).json({
        success: false,
        message: 'Ride not found'
      });
    }

    // Check authorization
    if (req.customerId && ride.customer.customerId.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized'
      });
    }

    if (req.driver && ride.driver?.driverId?.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized'
      });
    }

    let driverLocation = null;
    let driverDetails = null;

    if (ride.driver?.driverId) {
      const driver = await Driver.findById(ride.driver.driverId);
      if (driver && driver.currentLocation) {
        const [lng, lat] = driver.currentLocation.coordinates;
        driverLocation = { lat, lng };
        driverDetails = {
          name: driver.name,
          phone: driver.phone,
          vehicleType: driver.vehicleType,
          vehicleNumber: driver.vehicleNumber,
          rating: driver.rating
        };
      }
    }

    res.json({
      success: true,
      data: {
        rideId: ride.rideId,
        status: ride.status,
        driverLocation,
        driverDetails,
        pickupLocation: ride.pickupLocation,
        dropLocation: ride.dropLocation,
        dropLocations: ride.dropLocations || [],
        totalStops: ride.dropLocations?.length || 1,
        currentDropIndex: ride.currentDropIndex || 0,
        legDistances: ride.legDistances || [],
        fare: ride.fare,
        timestamps: {
          requestedAt: ride.requestedAt,
          driverAssignedAt: ride.driverAssignedAt,
          driverArrivedAt: ride.driverArrivedAt,
          rideStartedAt: ride.rideStartedAt,
          rideCompletedAt: ride.rideCompletedAt
        }
      }
    });

  } catch (error) {
    console.error('Get ride tracking info error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to get tracking info'
    });
  }
};

function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function getAverageSpeed(vehicleType) {
  const speeds = {
    'bike': 30,
    'auto': 25,
    'car': 30,
    'mini_truck': 25,
    'truck': 20
  };
  return speeds[vehicleType] || 25;
}
// Export all functions
export {
  findNearbyDrivers,
  handleDriverResponseTimeout
};