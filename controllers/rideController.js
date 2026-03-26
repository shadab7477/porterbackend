import Ride from "../models/Ride.js";
import Driver from "../models/Driver.js";
import Customer from "../models/Customer.js";
import axios from "axios";
import pusherService from "../services/pusherService.js";

// Google Maps API configuration
const GOOGLE_MAPS_API_KEY = "AIzaSyCgpFAvw-8Q8nHEHz4z5ztx449xZLkilyk";
const GOOGLE_MAPS_API_URL = "https://maps.googleapis.com/maps/api";

// ==================== HELPER FUNCTIONS ====================

export const calculateDistanceAndDuration = async (
  originLat,
  originLon,
  destLat,
  destLon,
  vehicleType = "car",
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
                  longitude: originLon,
                },
              },
            },
          },
        ],
        destinations: [
          {
            waypoint: {
              location: {
                latLng: {
                  latitude: destLat,
                  longitude: destLon,
                },
              },
            },
          },
        ],
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_AWARE",
      },
      {
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": GOOGLE_MAPS_API_KEY,
          "X-Goog-FieldMask": "distanceMeters,duration",
        },
      },
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
      durationInTrafficText: `${durationInMinutes} mins`,
    };
  } catch (error) {
    console.error(
      "Google Maps API error:",
      error.response?.data || error.message,
    );
    return fallbackCalculateDistanceAndDuration(
      originLat,
      originLon,
      destLat,
      destLon,
      vehicleType,
    );
  }
};

const fallbackCalculateDistanceAndDuration = (
  lat1,
  lon1,
  lat2,
  lon2,
  vehicleType = "car",
) => {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;

  const avgSpeeds = {
    bike: 30,
    auto: 25,
    car: 30,
    mini_truck: 25,
    truck: 20,
  };
  const speed = avgSpeeds[vehicleType] || 30;
  const duration = Math.ceil((distance / speed) * 60);

  return {
    distance: parseFloat(distance.toFixed(2)),
    duration,
    durationInTraffic: duration,
    distanceText: `${distance.toFixed(1)} km`,
    durationText: `${duration} mins`,
    durationInTrafficText: `${duration} mins`,
  };
};

const calculateHaversineDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

const formatRelativeTime = (date) => {
  const now = new Date();
  const diffInSeconds = Math.floor((now - new Date(date)) / 1000);

  if (diffInSeconds < 60) return `${diffInSeconds} seconds ago`;
  if (diffInSeconds < 3600)
    return `${Math.floor(diffInSeconds / 60)} minutes ago`;
  if (diffInSeconds < 86400)
    return `${Math.floor(diffInSeconds / 3600)} hours ago`;
  return `${Math.floor(diffInSeconds / 86400)} days ago`;
};

// ==================== GET DRIVER PENDING REQUESTS ====================

export const getDriverPendingRequests = async (req, res) => {
  try {
    const driverId = req.driver.id;
    const driver = await Driver.findById(driverId);

    if (!driver) {
      return res.status(404).json({
        success: false,
        message: "Driver not found",
      });
    }

    if (!driver.isOnline) {
      return res.json({
        success: true,
        data: {
          pendingRequests: [],
          count: 0,
          message: "You are offline. Please go online to see ride requests.",
          driverLocation: null,
        },
      });
    }

    if (
      !driver.currentLocation ||
      !driver.currentLocation.coordinates ||
      driver.currentLocation.coordinates.length < 2
    ) {
      return res.json({
        success: true,
        data: {
          pendingRequests: [],
          count: 0,
          message: "Please enable location to see nearby ride requests",
          driverLocation: null,
        },
      });
    }

    const [driverLon, driverLat] = driver.currentLocation.coordinates;

    const pendingRides = await Ride.aggregate([
      {
        $geoNear: {
          near: {
            type: "Point",
            coordinates: [parseFloat(driverLon), parseFloat(driverLat)],
          },
          distanceField: "distanceFromDriver",
          maxDistance: 5 * 1000,
          spherical: true,
          query: {
            status: "searching",
            "driver.driverId": { $exists: false },
          },
        },
      },
      {
        $lookup: {
          from: "customers",
          localField: "customer.customerId",
          foreignField: "_id",
          as: "customerDetails",
        },
      },
      {
        $addFields: {
          customerInfo: { $arrayElemAt: ["$customerDetails", 0] },
        },
      },
      {
        $project: {
          rideId: 1,
          "customer.customerId": 1,
          "customer.name": 1,
          "customer.rating": 1,
          "customerInfo.name": 1,
          "customerInfo.rating": 1,
          "customerInfo.totalTrips": 1,
          pickupLocation: 1,
          dropLocation: 1,
          distance: 1,
          duration: 1,
          routeInfo: 1,
          fare: 1,
          requestedAt: 1,
          driversNotified: 1,
          distanceFromDriver: 1,
          status: 1,
        },
      },
      { $sort: { requestedAt: -1 } },
      { $limit: 20 },
    ]);

    if (pendingRides.length === 0) {
      return res.json({
        success: true,
        data: {
          pendingRequests: [],
          count: 0,
          message: "No ride requests available within 5km of your location",
          driverLocation: {
            coordinates: [driverLon, driverLat],
            address: driver.currentLocation.address || "Current location",
          },
        },
      });
    }

    const pendingRequests = await Promise.all(
      pendingRides.map(async (ride) => {
        try {
          const wasNotified = ride.driversNotified?.some(
            (d) => d.driverId && d.driverId.toString() === driverId.toString(),
          );

          const hasResponded = ride.driversNotified?.some(
            (d) =>
              d.driverId &&
              d.driverId.toString() === driverId.toString() &&
              d.response &&
              d.response !== "pending",
          );

          if (hasResponded) return null;

          let expiresIn = 30;
          if (wasNotified) {
            const notification = ride.driversNotified?.find(
              (d) =>
                d.driverId && d.driverId.toString() === driverId.toString(),
            );
            if (notification?.notifiedAt) {
              const timeElapsed = Math.floor(
                (Date.now() - new Date(notification.notifiedAt).getTime()) /
                  1000,
              );
              expiresIn = Math.max(0, 30 - timeElapsed);
              if (expiresIn <= 0) return null;
            }
          }

          const [pickupLon, pickupLat] = ride.pickupLocation.coordinates;
          let etaToPickup = null;
          let etaText = null;

          try {
            const distanceInfo = await calculateDistanceAndDuration(
              driverLat,
              driverLon,
              pickupLat,
              pickupLon,
              driver.vehicleType,
            );
            etaToPickup = distanceInfo.duration;
            etaText = distanceInfo.durationText;
          } catch (err) {
            const distanceInKm = ride.distanceFromDriver / 1000;
            etaToPickup = Math.ceil((distanceInKm / 30) * 60);
            etaText = `${etaToPickup} mins`;
          }

          const customerName =
            ride.customerInfo?.name || ride.customer?.name || "Customer";
          const customerRating =
            ride.customerInfo?.rating || ride.customer?.rating || 0;
          const customerTotalRides = ride.customerInfo?.totalTrips || 0;

          return {
            rideId: ride.rideId,
            customerDetails: {
              name: customerName,
              rating: customerRating,
              totalRides: customerTotalRides,
            },
            pickupLocation: {
              address: ride.pickupLocation.address || "Pickup location",
              coordinates: ride.pickupLocation.coordinates,
              distanceFromDriver: parseFloat(
                (ride.distanceFromDriver / 1000).toFixed(1),
              ),
              distanceText: `${(ride.distanceFromDriver / 1000).toFixed(1)} km`,
              eta: etaToPickup,
              etaText: etaText,
            },
            dropLocation: {
              address: ride.dropLocation.address || "Drop location",
              coordinates: ride.dropLocation.coordinates,
            },
            rideDetails: {
              distance: ride.distance,
              distanceText:
                ride.routeInfo?.distanceText || `${ride.distance} km`,
              duration: ride.duration,
              durationText:
                ride.routeInfo?.durationText || `${ride.duration} mins`,
              estimatedFare: ride.fare?.total || 0,
              fareBreakdown: {
                distanceFare: ride.fare?.distanceFare || 0,
                total: ride.fare?.total || 0,
              },
            },
            requestedAt: ride.requestedAt,
            requestedTime: formatRelativeTime(ride.requestedAt),
            expiresIn: expiresIn,
            expiresInText: expiresIn > 0 ? `${expiresIn} seconds` : "Expired",
            wasNotified: wasNotified,
            isNew: !wasNotified,
          };
        } catch (err) {
          console.error("Error processing ride:", err);
          return null;
        }
      }),
    );

    const validRequests = pendingRequests.filter((r) => r !== null);

    validRequests.sort((a, b) => {
      if (a.wasNotified && !b.wasNotified) return -1;
      if (!a.wasNotified && b.wasNotified) return 1;
      if (a.wasNotified && b.wasNotified) {
        return a.expiresIn - b.expiresIn;
      }
      return (
        a.pickupLocation.distanceFromDriver -
        b.pickupLocation.distanceFromDriver
      );
    });

    res.json({
      success: true,
      data: {
        pendingRequests: validRequests,
        count: validRequests.length,
        searchRadius: 5,
        driverLocation: {
          coordinates: [driverLon, driverLat],
          address: driver.currentLocation.address || "Current location",
        },
        driverStatus: {
          isOnline: driver.isOnline,
          isAvailable: driver.isAvailable,
          vehicleType: driver.vehicleType,
        },
        summary: {
          totalAvailable: validRequests.length,
          notifiedRequests: validRequests.filter((r) => r.wasNotified).length,
          newRequests: validRequests.filter((r) => !r.wasNotified).length,
          averageDistance:
            validRequests.length > 0
              ? (
                  validRequests.reduce(
                    (sum, r) => sum + r.pickupLocation.distanceFromDriver,
                    0,
                  ) / validRequests.length
                ).toFixed(1)
              : 0,
        },
      },
    });
  } catch (error) {
    console.error("Get driver pending requests error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to get pending requests",
    });
  }
};

// ==================== RIDE REQUEST FLOW FUNCTIONS ====================

export const requestRide = async (req, res) => {
  try {
    const customerId = req.customerId;
    const {
      pickupLocation,
      dropLocation,
      vehicleType = "car",
      paymentMethod = "cash",
      receiver,
    } = req.body;

    const customer = await Customer.findById(customerId);
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    if (customer.isBlocked) {
      return res.status(403).json({
        success: false,
        message: "Your account has been blocked",
      });
    }

    if (!pickupLocation?.coordinates || !dropLocation?.coordinates) {
      return res.status(400).json({
        success: false,
        message: "Please provide pickup and drop locations with coordinates",
      });
    }

    const [pickupLon, pickupLat] = pickupLocation.coordinates;
    const [dropLon, dropLat] = dropLocation.coordinates;

    const routeInfo = await calculateDistanceAndDuration(
      pickupLat,
      pickupLon,
      dropLat,
      dropLon,
      vehicleType,
    );

    const distance = routeInfo.distance;
    const duration = routeInfo.duration;

    const fare = Ride.calculateFare(distance, vehicleType);

    const ride = new Ride({
      customer: {
        customerId,
        name: customer.name || "Customer",
        phone: customer.phone,
        rating: customer.rating || 0,
      },
      receiver: {
        name: receiver?.name || "",
        phone: receiver?.phone || "",
      },
      pickupLocation: {
        type: "Point",
        coordinates: [pickupLon, pickupLat],
        address: pickupLocation.address || "Pickup location",
      },
      dropLocation: {
        type: "Point",
        coordinates: [dropLon, dropLat],
        address: dropLocation.address || "Drop location",
      },
      distance,
      duration,
      routeInfo: {
        distanceText: routeInfo.distanceText,
        durationText: routeInfo.durationText,
        durationInTrafficText: routeInfo.durationInTrafficText,
      },
      fare: {
        distanceFare: fare.distanceFare,
        total: fare.total,
        finalAmount: fare.finalAmount,
      },
      paymentMethod,
      paymentStatus: "pending",
      status: "requested",
    });

    await ride.save();

    findNearbyDrivers(ride, req.app.get("pusherService"));

    res.status(201).json({
      success: true,
      message: "Ride requested successfully",
      data: {
        rideId: ride.rideId,
        status: ride.status,
        pickupLocation: ride.pickupLocation,
        dropLocation: ride.dropLocation,
        receiver: ride.receiver,
        distance: ride.distance,
        distanceText: routeInfo.distanceText,
        duration: ride.duration,
        durationText: routeInfo.durationText,
        fare: ride.fare,
        fareBreakdown: fare.breakdown,
        paymentMethod: ride.paymentMethod,
      },
    });
  } catch (error) {
    console.error("Request ride error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to request ride",
    });
  }
};

const findNearbyDrivers = async (ride, pusherService, radius = 5) => {
  try {
    const [longitude, latitude] = ride.pickupLocation.coordinates;

    ride.status = "searching";
    await ride.save();

    const nearbyDrivers = await Driver.aggregate([
      {
        $geoNear: {
          near: {
            type: "Point",
            coordinates: [parseFloat(longitude), parseFloat(latitude)],
          },
          distanceField: "distanceFromPickup",
          maxDistance: radius * 1000,
          spherical: true,
          query: {
            isOnline: true,
            isAvailable: true,
            isBlocked: false,
          },
        },
      },
      { $limit: 10 },
    ]);

    if (nearbyDrivers.length === 0) {
      ride.status = "no_drivers";
      await ride.save();

      const channelName = pusherService.getRideChannel(ride.rideId);
      await pusherService.getPusher().trigger(channelName, "ride:no_drivers", {
        rideId: ride.rideId,
        message: "No drivers available in your area",
      });
      return;
    }

    const notifiedDrivers = [];

    for (const driver of nearbyDrivers) {
      const [driverLon, driverLat] = driver.currentLocation.coordinates;
      const etaInfo = await calculateDistanceAndDuration(
        driverLat,
        driverLon,
        latitude,
        longitude,
        driver.vehicleType,
      );

      notifiedDrivers.push({
        driverId: driver._id,
        notifiedAt: new Date(),
        response: "pending",
        distanceToPickup: etaInfo.distance,
        durationToPickup: etaInfo.duration,
        distanceFromPickup: driver.distanceFromPickup / 1000,
      });

      await pusherService
        .getPusher()
        .trigger(`private-driver-${driver._id}`, "ride:new_request", {
          rideId: ride.rideId,
          pickupLocation: ride.pickupLocation,
          dropLocation: ride.dropLocation,
          distance: ride.distance,
          distanceText: ride.routeInfo.distanceText,
          estimatedFare: ride.fare.total,
          customerRating: ride.customer.rating,
          distanceFromDriver: etaInfo.distance,
          distanceFromDriverText: etaInfo.distanceText,
          etaToPickup: etaInfo.duration,
          etaToPickupText: etaInfo.durationText,
          expiresIn: 30,
        });
    }

    ride.driversNotified = notifiedDrivers;
    await ride.save();

    setTimeout(() => handleDriverResponseTimeout(ride, pusherService), 30000);
  } catch (error) {
    console.error("Find nearby drivers error:", error);
  }
};

const handleDriverResponseTimeout = async (ride, pusherService) => {
  try {
    const updatedRide = await Ride.findOne({ rideId: ride.rideId });

    if (!updatedRide || updatedRide.status !== "searching") {
      return;
    }

    const acceptedDrivers = updatedRide.driversNotified.filter(
      (d) => d.response === "accepted",
    );

    if (acceptedDrivers.length === 0) {
      updatedRide.status = "no_drivers";
      await updatedRide.save();

      const channelName = pusherService.getRideChannel(ride.rideId);
      await pusherService.getPusher().trigger(channelName, "ride:timeout", {
        rideId: ride.rideId,
        message: "No drivers accepted your request",
      });
    }
  } catch (error) {
    console.error("Driver response timeout error:", error);
  }
};

// ==================== ACCEPT RIDE WITH PUSHER ====================

export const acceptRide = async (req, res) => {
  try {
    const driverId = req.driver.id;
    const { rideId } = req.body;

    const driver = await Driver.findById(driverId);
    if (!driver || !driver.isOnline || !driver.isAvailable) {
      return res.status(400).json({
        success: false,
        message: "You must be online and available to accept rides",
      });
    }

    const ride = await Ride.findOne({
      rideId,
      status: { $in: ["searching", "no_drivers"] },
    });

    if (!ride) {
      return res.status(404).json({
        success: false,
        message: "Ride not found or already assigned",
      });
    }

    const [driverLon, driverLat] = driver.currentLocation.coordinates;
    const [pickupLon, pickupLat] = ride.pickupLocation.coordinates;

    const distanceToPickup = calculateHaversineDistance(
      driverLat,
      driverLon,
      pickupLat,
      pickupLon,
    );

    const MAX_ACCEPTABLE_DISTANCE = 5;
    if (distanceToPickup > MAX_ACCEPTABLE_DISTANCE) {
      return res.status(400).json({
        success: false,
        message: `You are too far from pickup location (${distanceToPickup.toFixed(1)}km). Maximum allowed is ${MAX_ACCEPTABLE_DISTANCE}km.`,
      });
    }

    const etaInfo = await calculateDistanceAndDuration(
      driverLat,
      driverLon,
      pickupLat,
      pickupLon,
      driver.vehicleType,
    );

    const existingNotification = ride.driversNotified?.find(
      (d) => d.driverId && d.driverId.toString() === driverId,
    );

    if (existingNotification) {
      existingNotification.response = "accepted";
      existingNotification.respondedAt = new Date();
    } else {
      if (!ride.driversNotified) ride.driversNotified = [];
      ride.driversNotified.push({
        driverId: driver._id,
        notifiedAt: new Date(),
        response: "accepted",
        respondedAt: new Date(),
        distanceToPickup: distanceToPickup,
      });
    }

    ride.driver = {
      driverId: driver._id,
      name: driver.name,
      phone: driver.phone,
      vehicleType: driver.vehicleType,
      vehicleNumber: driver.vehicleNumber,
      rating: driver.rating || 0,
    };

    ride.updateStatus("driver_assigned");
    ride.driverETA = {
      distance: etaInfo.distance,
      duration: etaInfo.duration,
      distanceText: etaInfo.distanceText,
      durationText: etaInfo.durationText,
    };

    if (ride.driversNotified && ride.driversNotified.length > 0) {
      ride.driversNotified.forEach((d) => {
        if (d.driverId.toString() !== driverId && d.response === "pending") {
          d.response = "rejected";
          d.respondedAt = new Date();
        }
      });
    }

    await ride.save();

    driver.isAvailable = false;
    driver.currentRide = rideId;
    await driver.save();

    const pusherService = req.app.get("pusherService");

    await pusherService.joinDriverTracking(driverId, rideId);
    await pusherService.updateRideStatus(rideId, "driver_assigned", driverId);

    const channelName = pusherService.getRideChannel(rideId);
    await pusherService.getPusher().trigger(channelName, "ride:accepted", {
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
        lng: driverLon,
      },
      eta: etaInfo.duration,
      etaText: etaInfo.durationText,
      distanceToPickup: etaInfo.distance,
      distanceToPickupText: etaInfo.distanceText,
    });

    if (ride.driversNotified && ride.driversNotified.length > 0) {
      ride.driversNotified.forEach((d) => {
        if (d.driverId.toString() !== driverId) {
          pusherService
            .getPusher()
            .trigger(`private-driver-${d.driverId}`, "ride:assigned_to_other", {
              rideId: ride.rideId,
              message: "This ride was accepted by another driver",
            });
        }
      });
    }

    const distanceText = ride.routeInfo?.distanceText || `${ride.distance} km`;

    res.json({
      success: true,
      message: "Ride accepted successfully",
      data: {
        rideId: ride.rideId,
        customer: {
          customerId: ride.customer.customerId,
          name: ride.customer.name,
          phone: ride.customer.phone,
        },
        driver: {
          driverId: driver._id,
          name: driver.name,
          phone: driver.phone,
          vehicleType: driver.vehicleType,
          vehicleNumber: driver.vehicleNumber,
          rating: driver.rating,
          lat: driverLat,
          lng: driverLon,
        },
        pickupLocation: ride.pickupLocation,
        dropLocation: ride.dropLocation,
        estimatedFare: ride.fare.total,
        distance: ride.distance,
        distanceText: distanceText,
        eta: etaInfo.duration,
        etaText: etaInfo.durationText,
        routeToPickup: {
          distance: etaInfo.distance,
          duration: etaInfo.duration,
          distanceText: etaInfo.distanceText,
          durationText: etaInfo.durationText,
        },
      },
    });
  } catch (error) {
    console.error("Accept ride error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to accept ride",
    });
  }
};

export const rejectRide = async (req, res) => {
  try {
    const driverId = req.driver.id;
    const { rideId, reason } = req.body;

    const ride = await Ride.findOne({ rideId, status: "searching" });
    if (!ride) {
      return res.status(404).json({
        success: false,
        message: "Ride not found",
      });
    }

    const notifiedDriver = ride.driversNotified.find(
      (d) => d.driverId.toString() === driverId && d.response === "pending",
    );

    if (notifiedDriver) {
      notifiedDriver.response = "rejected";
      notifiedDriver.respondedAt = new Date();
      notifiedDriver.rejectionReason = reason;
      await ride.save();
    }

    res.json({
      success: true,
      message: "Ride rejected",
    });
  } catch (error) {
    console.error("Reject ride error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to reject ride",
    });
  }
};

// ==================== DRIVER ARRIVED WITH PUSHER ====================

export const driverArrived = async (req, res) => {
  try {
    const driverId = req.driver.id;
    const { rideId } = req.body;

    const ride = await Ride.findOne({
      rideId,
      "driver.driverId": driverId,
      status: "driver_assigned",
    });

    if (!ride) {
      return res.status(404).json({
        success: false,
        message: "Ride not found or not in correct state",
      });
    }

    ride.updateStatus("driver_arrived");
    await ride.save();

    const pusherService = req.app.get("pusherService");
    await pusherService.driverArrived(rideId, driverId, null);

    res.json({
      success: true,
      message: "Marked as arrived at pickup",
      data: {
        rideId: ride.rideId,
        status: ride.status,
        arrivedAt: ride.driverArrivedAt,
      },
    });
  } catch (error) {
    console.error("Driver arrived error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to mark arrival",
    });
  }
};

// ==================== START RIDE WITH PUSHER ====================

export const startRide = async (req, res) => {
  try {
    const driverId = req.driver.id;
    const { rideId } = req.body;

    const ride = await Ride.findOne({
      rideId,
      "driver.driverId": driverId,
      status: "driver_arrived",
    });

    if (!ride) {
      return res.status(404).json({
        success: false,
        message: "Ride not found or not in correct state",
      });
    }

    if (ride.paymentMethod !== "cash" && ride.paymentStatus !== "completed") {
      return res.status(400).json({
        success: false,
        message: "Payment must be completed before starting the ride",
        paymentRequired: true,
        paymentStatus: ride.paymentStatus,
        paymentMethod: ride.paymentMethod,
        amount: ride.fare.finalAmount,
      });
    }

    ride.updateStatus("in_progress");
    await ride.save();

    const pusherService = req.app.get("pusherService");
    await pusherService.rideStarted(rideId, driverId);

    res.json({
      success: true,
      message: "Ride started",
      data: {
        rideId: ride.rideId,
        status: ride.status,
        startedAt: ride.rideStartedAt,
        receiver: ride.receiver,
        dropLocation: ride.dropLocation,
      },
    });
  } catch (error) {
    console.error("Start ride error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to start ride",
    });
  }
};

// ==================== COMPLETE RIDE WITH PUSHER ====================

export const completeRide = async (req, res) => {
  try {
    const driverId = req.driver.id;
    const { rideId } = req.body;

    const ride = await Ride.findOne({
      rideId,
      "driver.driverId": driverId,
      status: "in_progress",
    });

    if (!ride) {
      return res.status(404).json({
        success: false,
        message: "Ride not found or not in correct state",
      });
    }

    const driver = await Driver.findById(driverId);
    const [driverLon, driverLat] = driver.currentLocation.coordinates;
    const [dropLon, dropLat] = ride.dropLocation.coordinates;

    const finalRouteInfo = await calculateDistanceAndDuration(
      driverLat,
      driverLon,
      dropLat,
      dropLon,
      ride.driver.vehicleType,
    );

    ride.actualDistance = finalRouteInfo.distance;
    ride.actualDuration = finalRouteInfo.duration;
    ride.updateStatus("completed");

    if (ride.paymentMethod === "cash") {
      ride.paymentStatus = "completed";
    }

    await ride.save();

    driver.totalTrips += 1;
    driver.totalEarnings += ride.fare.finalAmount;
    driver.isAvailable = true;
    driver.currentRide = null;
    await driver.save();

    const pusherService = req.app.get("pusherService");
    await pusherService.rideCompleted(
      rideId,
      driverId,
      ride.fare.finalAmount,
      ride.paymentMethod,
    );

    res.json({
      success: true,
      message: "Ride completed successfully",
      data: {
        rideId: ride.rideId,
        status: ride.status,
        fare: ride.fare.finalAmount,
        paymentMethod: ride.paymentMethod,
        paymentStatus: ride.paymentStatus,
        completedAt: ride.rideCompletedAt,
        actualDistance: finalRouteInfo.distanceText,
        actualDuration: finalRouteInfo.durationText,
        receiver: ride.receiver,
      },
    });
  } catch (error) {
    console.error("Complete ride error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to complete ride",
    });
  }
};

// ==================== CANCEL RIDE ====================

export const cancelRide = async (req, res) => {
  try {
    const { rideId, reason } = req.body;

    let userType = null;
    let userId = null;

    if (req.customerId) {
      userType = "customer";
      userId = req.customerId;
    } else if (req.driver && req.driver.id) {
      userType = "driver";
      userId = req.driver.id;
    } else if (req.adminId) {
      userType = "admin";
      userId = req.adminId;
    }

    if (!userType) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    if (!rideId) {
      return res.status(400).json({
        success: false,
        message: "Ride ID is required",
      });
    }

    const ride = await Ride.findOne({ rideId })
      .populate("customer.customerId")
      .populate("driver.driverId");

    if (!ride) {
      return res.status(404).json({
        success: false,
        message: `Ride with ID ${rideId} not found`,
      });
    }

    const cancellableStatuses = ["requested", "searching", "driver_assigned"];
    if (!cancellableStatuses.includes(ride.status)) {
      return res.status(400).json({
        success: false,
        message: `Ride cannot be cancelled. Current status: ${ride.status}.`,
      });
    }

    let isAuthorized = false;

    if (userType === "customer") {
      const rideCustomerId =
        ride.customer?.customerId?._id?.toString() ||
        ride.customer?.customerId?.toString();
      if (rideCustomerId === userId.toString()) isAuthorized = true;
    } else if (userType === "driver") {
      const rideDriverId =
        ride.driver?.driverId?._id?.toString() ||
        ride.driver?.driverId?.toString();
      if (rideDriverId === userId.toString()) isAuthorized = true;
    } else if (userType === "admin") {
      isAuthorized = true;
    }

    if (!isAuthorized) {
      return res.status(403).json({
        success: false,
        message: `Not authorized to cancel this ride.`,
      });
    }

    ride.status = "cancelled";
    ride.cancelledAt = new Date();
    ride.cancelledBy = userType;
    ride.cancellationReason =
      reason ||
      (userType === "customer"
        ? "Cancelled by customer"
        : userType === "driver"
          ? "Cancelled by driver"
          : "Cancelled by admin");
    ride.cancellationFee = 0;

    let refundAmount = 0;
    let paymentRefundNeeded = false;

    if (ride.paymentMethod !== "cash" && ride.paymentStatus === "completed") {
      refundAmount = ride.fare.finalAmount;
      paymentRefundNeeded = true;
      ride.paymentStatus = "refunded";
      ride.refundAmount = refundAmount;
      ride.refundProcessedAt = new Date();
    }

    await ride.save();

    if (ride.driver && ride.driver.driverId) {
      const driver = await Driver.findById(ride.driver.driverId);
      if (driver) {
        driver.isAvailable = true;
        driver.currentRide = null;
        await driver.save();
      }
    }

    const pusherService = req.app.get("pusherService");
    const channelName = pusherService.getRideChannel(rideId);

    const cancellationData = {
      rideId: ride.rideId,
      cancelledBy: userType,
      reason: ride.cancellationReason,
      timestamp: new Date(),
      message: `Ride cancelled by ${userType}`,
      cancellationFee: 0,
    };

    if (paymentRefundNeeded) {
      cancellationData.refundAmount = refundAmount;
      cancellationData.message = `Ride cancelled. Full refund of ₹${refundAmount} will be processed.`;
    }

    await pusherService
      .getPusher()
      .trigger(channelName, "ride:cancelled", cancellationData);

    if (ride.customer && ride.customer.customerId && userType !== "customer") {
      await pusherService
        .getPusher()
        .trigger(
          `private-customer-${ride.customer.customerId}`,
          "ride:cancelled",
          cancellationData,
        );
    }

    if (ride.driver && ride.driver.driverId && userType !== "driver") {
      await pusherService
        .getPusher()
        .trigger(
          `private-driver-${ride.driver.driverId}`,
          "ride:cancelled",
          cancellationData,
        );
    }

    const responseData = {
      rideId: ride.rideId,
      status: ride.status,
      cancelledAt: ride.cancelledAt,
      cancelledBy: ride.cancelledBy,
      cancellationReason: ride.cancellationReason,
      message: `Ride cancelled successfully`,
    };

    if (paymentRefundNeeded) {
      responseData.refundAmount = refundAmount;
      responseData.paymentStatus = ride.paymentStatus;
      responseData.message = `Ride cancelled successfully. Full refund of ₹${refundAmount} will be processed.`;
    }

    res.json({
      success: true,
      message: responseData.message,
      data: responseData,
    });
  } catch (error) {
    console.error("Cancel ride error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to cancel ride",
    });
  }
};

// ==================== UPDATE DRIVER LOCATION WITH PUSHER ====================

export const updateDriverLocation = async (req, res) => {
  try {
    const driverId = req.driver.id;
    const { latitude, longitude, rideId } = req.body;

    if (!latitude || !longitude) {
      return res.status(400).json({
        success: false,
        message: "Latitude and longitude are required",
      });
    }

    const driver = await Driver.findByIdAndUpdate(
      driverId,
      {
        currentLocation: {
          type: "Point",
          coordinates: [parseFloat(longitude), parseFloat(latitude)],
        },
        lastActive: new Date(),
      },
      { new: true },
    );

    if (!driver) {
      return res.status(404).json({
        success: false,
        message: "Driver not found",
      });
    }

    if (rideId) {
      const pusherService = req.app.get("pusherService");
      await pusherService.updateDriverLocation(
        driverId,
        rideId,
        latitude,
        longitude,
      );
    }

    res.json({
      success: true,
      message: "Location updated successfully",
      data: {
        lat: latitude,
        lng: longitude,
        lastActive: driver.lastActive,
      },
    });
  } catch (error) {
    console.error("Update driver location error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to update location",
    });
  }
};

// ==================== TRACK RIDE ====================

export const trackRide = async (req, res) => {
  try {
    const customerId = req.customerId;
    const { rideId } = req.params;

    const ride = await Ride.findOne({
      rideId,
      "customer.customerId": customerId,
      status: { $in: ["driver_assigned", "driver_arrived", "in_progress"] },
    }).populate("driver.driverId");

    if (!ride) {
      return res.status(404).json({
        success: false,
        message: "Active ride not found",
      });
    }

    const driver = ride.driver.driverId;
    const driverLocation = driver?.currentLocation?.coordinates || null;

    let eta = null;
    let etaText = null;
    let distanceToTarget = null;
    let distanceToTargetText = null;

    if (
      driverLocation &&
      (ride.status === "driver_assigned" || ride.status === "driver_arrived")
    ) {
      const etaInfo = await calculateDistanceAndDuration(
        driverLocation[1],
        driverLocation[0],
        ride.pickupLocation.coordinates[1],
        ride.pickupLocation.coordinates[0],
        driver?.vehicleType,
      );
      eta = etaInfo.duration;
      etaText = etaInfo.durationText;
      distanceToTarget = etaInfo.distance;
      distanceToTargetText = etaInfo.distanceText;
    } else if (driverLocation && ride.status === "in_progress") {
      const etaInfo = await calculateDistanceAndDuration(
        driverLocation[1],
        driverLocation[0],
        ride.dropLocation.coordinates[1],
        ride.dropLocation.coordinates[0],
        driver?.vehicleType,
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
        driver: {
          name: ride.driver.name,
          vehicleType: ride.driver.vehicleType,
          vehicleNumber: ride.driver.vehicleNumber,
          rating: ride.driver.rating,
          phone: ride.driver.phone,
        },
        tracking: ride.tracking.slice(-10),
      },
    });
  } catch (error) {
    console.error("Track ride error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to track ride",
    });
  }
};

// ==================== GET RIDE STATUS ====================

export const getRideStatus = async (req, res) => {
  try {
    const { rideId } = req.params;
    const userId = req.customerId || req.driver?.id;
    const userType = req.customerId ? "customer" : req.driver ? "driver" : null;

    const ride = await Ride.findOne({ rideId });

    if (!ride) {
      return res.status(404).json({
        success: false,
        message: "Ride not found",
      });
    }

    if (
      userType === "customer" &&
      ride.customer.customerId.toString() !== userId
    ) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to view this ride",
      });
    }

    if (userType === "driver" && ride.driver?.driverId?.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to view this ride",
      });
    }

    res.json({
      success: true,
      data: {
        rideId: ride.rideId,
        status: ride.status,
        driver: ride.driver
          ? {
              name: ride.driver.name,
              vehicleType: ride.driver.vehicleType,
              vehicleNumber: ride.driver.vehicleNumber,
              rating: ride.driver.rating,
              phone: ride.driver.phone,
            }
          : null,
        customer: ride.customer
          ? {
              name: ride.customer.name,
              phone: ride.customer.phone,
              rating: ride.customer.rating,
            }
          : null,
        pickupLocation: ride.pickupLocation,
        dropLocation: ride.dropLocation,
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
          cancelledAt: ride.cancelledAt,
        },
      },
    });
  } catch (error) {
    console.error("Get ride status error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to get ride status",
    });
  }
};

// ==================== RATE DRIVER ====================

export const rateDriver = async (req, res) => {
  try {
    const customerId = req.customerId;
    const { rideId } = req.params;
    const { rating, review } = req.body;

    const ride = await Ride.findOne({
      rideId,
      "customer.customerId": customerId,
      status: "completed",
    });

    if (!ride) {
      return res.status(404).json({
        success: false,
        message: "Completed ride not found",
      });
    }

    if (ride.customerRating?.givenAt) {
      return res.status(400).json({
        success: false,
        message: "You have already rated this driver",
      });
    }

    ride.customerRating = {
      rating,
      review,
      givenAt: new Date(),
    };

    await ride.save();

    const driverRides = await Ride.find({
      "driver.driverId": ride.driver.driverId,
      "customerRating.rating": { $exists: true },
    });

    const avgRating =
      driverRides.reduce((acc, r) => acc + r.customerRating.rating, 0) /
      driverRides.length;

    await Driver.findByIdAndUpdate(ride.driver.driverId, {
      rating: Math.round(avgRating * 10) / 10,
    });

    res.json({
      success: true,
      message: "Driver rated successfully",
      data: {
        rating,
        driverRating: avgRating,
      },
    });
  } catch (error) {
    console.error("Rate driver error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to rate driver",
    });
  }
};

// ==================== RATE CUSTOMER ====================

export const rateCustomer = async (req, res) => {
  try {
    const driverId = req.driver.id;
    const { rideId } = req.params;
    const { rating, review } = req.body;

    const ride = await Ride.findOne({
      rideId,
      "driver.driverId": driverId,
      status: "completed",
    });

    if (!ride) {
      return res.status(404).json({
        success: false,
        message: "Completed ride not found",
      });
    }

    if (ride.driverRating?.givenAt) {
      return res.status(400).json({
        success: false,
        message: "You have already rated this customer",
      });
    }

    ride.driverRating = {
      rating,
      review,
      givenAt: new Date(),
    };

    await ride.save();

    const customerRides = await Ride.find({
      "customer.customerId": ride.customer.customerId,
      "driverRating.rating": { $exists: true },
    });

    const avgRating =
      customerRides.reduce((acc, r) => acc + r.driverRating.rating, 0) /
      customerRides.length;

    await Customer.findByIdAndUpdate(ride.customer.customerId, {
      rating: Math.round(avgRating * 10) / 10,
    });

    res.json({
      success: true,
      message: "Customer rated successfully",
      data: {
        rating,
        customerRating: avgRating,
      },
    });
  } catch (error) {
    console.error("Rate customer error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to rate customer",
    });
  }
};

// ==================== GET CUSTOMER RIDE HISTORY ====================

export const getCustomerRideHistory = async (req, res) => {
  try {
    const customerId = req.customerId;
    const { page = 1, limit = 10, status } = req.query;

    const query = { "customer.customerId": customerId };
    if (status) query.status = status;

    const rides = await Ride.find(query)
      .sort({ requestedAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .select("-tracking -driversNotified");

    const total = await Ride.countDocuments(query);

    const totals = await Ride.aggregate([
      { $match: { "customer.customerId": customerId, status: "completed" } },
      {
        $group: {
          _id: null,
          totalSpent: { $sum: "$fare.finalAmount" },
          totalRides: { $sum: 1 },
          averageRating: { $avg: "$driverRating.rating" },
        },
      },
    ]);

    res.json({
      success: true,
      data: {
        rides: rides.map((ride) => ({
          ...ride.toObject(),
          distanceText: ride.routeInfo?.distanceText,
          durationText: ride.routeInfo?.durationText,
        })),
        stats: {
          totalRides: totals[0]?.totalRides || 0,
          totalSpent: totals[0]?.totalSpent || 0,
          averageRating: totals[0]?.averageRating || 0,
        },
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    console.error("Get customer ride history error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to get ride history",
    });
  }
};

// ==================== GET DRIVER RIDE HISTORY ====================

export const getDriverRideHistory = async (req, res) => {
  try {
    const driverId = req.driver.id;
    const { page = 1, limit = 10, status } = req.query;

    const query = { "driver.driverId": driverId };
    if (status) query.status = status;

    const rides = await Ride.find(query)
      .sort({ requestedAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .select("-tracking -driversNotified");

    const total = await Ride.countDocuments(query);

    const earnings = await Ride.aggregate([
      { $match: { "driver.driverId": driverId, status: "completed" } },
      {
        $group: {
          _id: null,
          totalEarnings: { $sum: "$fare.finalAmount" },
          totalRides: { $sum: 1 },
          averageRating: { $avg: "$customerRating.rating" },
        },
      },
    ]);

    res.json({
      success: true,
      data: {
        rides: rides.map((ride) => ({
          ...ride.toObject(),
          distanceText: ride.routeInfo?.distanceText,
          durationText: ride.routeInfo?.durationText,
        })),
        stats: {
          totalRides: earnings[0]?.totalRides || 0,
          totalEarnings: earnings[0]?.totalEarnings || 0,
          averageRating: earnings[0]?.averageRating || 0,
        },
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    console.error("Get driver ride history error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to get ride history",
    });
  }
};

// ==================== GET NEARBY DRIVERS ====================

export const getNearbyDrivers = async (req, res) => {
  try {
    const { latitude, longitude, radius = 5, vehicleType } = req.query;

    if (!latitude || !longitude) {
      return res.status(400).json({
        success: false,
        message: "Latitude and longitude are required",
      });
    }

    const queryConditions = {
      isOnline: true,
      isAvailable: true,
      isBlocked: false,
    };

    if (vehicleType) {
      queryConditions.vehicleType = vehicleType;
    }

    const drivers = await Driver.aggregate([
      {
        $geoNear: {
          near: {
            type: "Point",
            coordinates: [parseFloat(longitude), parseFloat(latitude)],
          },
          distanceField: "distance",
          maxDistance: radius * 1000,
          spherical: true,
          query: queryConditions,
        },
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
          isAvailable: 1,
        },
      },
    ]);

    const driversWithDetails = await Promise.all(
      drivers.map(async (driver) => {
        const [driverLon, driverLat] = driver.currentLocation.coordinates;
        const etaInfo = await calculateDistanceAndDuration(
          driverLat,
          driverLon,
          parseFloat(latitude),
          parseFloat(longitude),
          driver.vehicleType,
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
          isAvailable: driver.isAvailable,
        };
      }),
    );

    driversWithDetails.sort((a, b) => a.distance - b.distance);

    res.json({
      success: true,
      data: {
        count: driversWithDetails.length,
        drivers: driversWithDetails,
        searchRadius: radius,
      },
    });
  } catch (error) {
    console.error("Get nearby drivers error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to get nearby drivers",
    });
  }
};

// ==================== CALCULATE FARE ESTIMATE ====================

export const calculateFareEstimate = async (req, res) => {
  try {
    const {
      pickupLat,
      pickupLon,
      dropLat,
      dropLon,
      vehicleType = "car",
    } = req.query;

    if (!pickupLat || !pickupLon || !dropLat || !dropLon) {
      return res.status(400).json({
        success: false,
        message: "Please provide all coordinates",
      });
    }

    const routeInfo = await calculateDistanceAndDuration(
      parseFloat(pickupLat),
      parseFloat(pickupLon),
      parseFloat(dropLat),
      parseFloat(dropLon),
      vehicleType,
    );

    const fare = Ride.calculateFare(routeInfo.distance, vehicleType);

    const nearbyDriversResult = await Driver.aggregate([
      {
        $geoNear: {
          near: {
            type: "Point",
            coordinates: [parseFloat(pickupLon), parseFloat(pickupLat)],
          },
          distanceField: "distance",
          maxDistance: 5 * 1000,
          spherical: true,
          query: {
            isOnline: true,
            isAvailable: true,
            isBlocked: false,
          },
        },
      },
      { $count: "count" },
    ]);

    const nearbyDriversCount = nearbyDriversResult[0]?.count || 0;

    res.json({
      success: true,
      data: {
        distance: routeInfo.distance,
        distanceText: routeInfo.distanceText,
        duration: routeInfo.duration,
        durationText: routeInfo.durationText,
        durationInTraffic: routeInfo.durationInTraffic,
        durationInTrafficText: routeInfo.durationInTrafficText,
        fare: {
          distanceFare: fare.distanceFare,
          total: fare.total,
          breakdown: fare.breakdown,
        },
        vehicleType,
        nearbyDrivers: nearbyDriversCount,
        estimatedArrival:
          Math.min(routeInfo.durationInTraffic, routeInfo.duration) + 5,
      },
    });
  } catch (error) {
    console.error("Calculate fare error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to calculate fare",
    });
  }
};

// ==================== GET RIDE TRACKING INFO ====================

export const getRideTrackingInfo = async (req, res) => {
  try {
    const { rideId } = req.params;
    const userId = req.customerId || req.driver?.id;

    const ride = await Ride.findOne({ rideId });

    if (!ride) {
      return res.status(404).json({
        success: false,
        message: "Ride not found",
      });
    }

    if (req.customerId && ride.customer.customerId.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: "Not authorized",
      });
    }

    if (req.driver && ride.driver?.driverId?.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: "Not authorized",
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
          rating: driver.rating,
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
        fare: ride.fare,
        timestamps: {
          requestedAt: ride.requestedAt,
          driverAssignedAt: ride.driverAssignedAt,
          driverArrivedAt: ride.driverArrivedAt,
          rideStartedAt: ride.rideStartedAt,
          rideCompletedAt: ride.rideCompletedAt,
        },
      },
    });
  } catch (error) {
    console.error("Get ride tracking info error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to get tracking info",
    });
  }
};

// ==================== EXPORT ALL FUNCTIONS ====================

export { findNearbyDrivers, handleDriverResponseTimeout };
