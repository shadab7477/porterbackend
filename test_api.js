import axios from 'axios';

async function testFare() {
  try {
    const res = await axios.get('http://127.0.0.1:5001/api/rides/fare-estimate', {
      params: {
        pickupLat: 22.7196,
        pickupLon: 75.8577,
        dropLat: 22.7800,
        dropLon: 75.8577,
        vehicleType: 'scooter'
      }
    });
    console.log(JSON.stringify(res.data, null, 2));
  } catch (err) {
    console.error(err.response ? err.response.data : err.message);
  }
}

testFare();
