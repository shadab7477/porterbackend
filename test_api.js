import axios from 'axios';

async function testFare() {
  try {
    const res = await axios.get('http://127.0.0.1:5001/api/rides/fare-estimate', {
      params: {
        pickupLat: 22.77019719228216,
        pickupLon: 75.8990738497349,
        dropLat: 22.745581997175826,
        dropLon: 75.90371147905188,
        vehicleType: 'scooter'
      }
    });
    console.log(JSON.stringify(res.data, null, 2));
  } catch (err) {
    console.error(err.response ? err.response.data : err.message);
  }
}

testFare();
