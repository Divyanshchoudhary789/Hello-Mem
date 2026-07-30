const sendEmail = async (options) => {
  try {
    const response = await fetch(
      "https://api.brevo.com/v3/smtp/email",
      {
        method: "POST",
        headers: {
          "accept": "application/json",
          "content-type": "application/json",
          "api-key": process.env.BREVO_API_KEY,
        },
        body: JSON.stringify({
          sender: {
            name: "HelloMaam",
            email: process.env.EMAIL_FROM,
          },
          to: [
            {
              email: options.email,
            },
          ],
          subject: options.subject,
          textContent: options.message,
        }),
      }
    );
    const data = await response.json();
    if (!response.ok) {
      console.log("BREVO ERROR:", data);
      throw new Error(data.message);
    }
  } catch (error) {
    console.log("EMAIL ERROR:", error.message);
    throw error;

  }
};


module.exports = sendEmail;