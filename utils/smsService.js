import axios from "axios";

const SMS_CONFIG = {
  ukey: "2W24DQJ6Nul7bJtgNjtt4CHVd",
  senderId: "Delivo",
  creditType: 2,           // 2 = Transactional (better for OTPs)
  language: 0,             // English
  // No templateId – we use raw message
};

export const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

export const sendSmsOtp = async (mobile, otp) => {
  try {
    const { ukey, senderId, creditType, language } = SMS_CONFIG;

    const message = `your godevlivo otp is ${otp} to complete your booking. it is valid for 15 minutes. do not share it with anyone. #godevlivo`;

    // Build GET URL with parameters
    const url = "https://api.voicensms.in/SMSAPI/webresources/CreateSMSCampaignGet";
    const params = {
      ukey,
      msisdn: mobile,
      language,
      credittype: creditType,
      senderid: senderId,
      templateid: 0,               // 0 means custom message
      message: message,
      filetype: 2,                 // Single number
      isrefno: true,               // Get reference number
      // dlttemplateid is NOT needed for GET (but add if your API requires it)
    };

    const { data } = await axios.get(url, { params });

    console.log("✅ SMS GET response:", data);
    console.log(`📲 OTP ${otp} sent to ${mobile}`);

    // Adjust success condition based on actual API response
    if (data.status === "success" || data.responseCode === "0") {
      return { success: true, data };
    } else {
      return { success: false, error: data.value || data.message || "SMS failed" };
    }
  } catch (err) {
    console.error("❌ Error sending SMS OTP via GET:", err.message);
    return { success: false, error: err.message };
  }
};