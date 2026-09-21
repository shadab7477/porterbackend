async function sendTestMessage() {
  try {
    const res = await fetch('http://localhost:5001/api/chat/message', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY5YjkxOGQ3YTQ1NzhlYzZkYjUxMjQ2OCIsInBob25lIjoiNzA0OTY4ODUxMCIsInJvbGUiOiJjdXN0b21lciIsImlhdCI6MTc4NDg4MjkyMSwiZXhwIjoxODcxMTk2NTIxfQ.hNZABCbCtihEG4jSqtWeJaWNXRk_Drh-8sDxAUsEyYg'
      },
      body: JSON.stringify({
        rideId: "RID84393997302",
        message: "Hello driver, where are you?"
      })
    });
    
    const data = await res.json();
    console.log("Status:", res.status);
    console.log("Response:", JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("Error:", err);
  }
}

sendTestMessage();
