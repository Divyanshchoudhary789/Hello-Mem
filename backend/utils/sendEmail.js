const sendEmail = async (options) => {
  try {
    const payload = {
      recipients: [
        {
          to: [
            {
              name: options.name || "",
              email: options.email,
            },
          ],
        },
      ],
      from: {
        name: "HelloMem",
        email: process.env.EMAIL_FROM,
      },
      domain: process.env.MSG91_DOMAIN,
      subject: options.subject,
      email_content: options.message,
      email_content_type: options.html ? "html" : "text",
      validate_before_send: true,
    };

    if (options.replyTo) {
      payload.reply_to = [{ email: options.replyTo }];
    }

    if (options.templateId) {
      payload.template_id = options.templateId;
      payload.email_content = undefined;
      payload.email_content_type = undefined;
      payload.subject = undefined;
      if (options.templateData) {
        payload.recipients[0].variables = options.templateData;
      }
    }

    const response = await fetch(
      "https://control.msg91.com/api/v5/email/send",
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          authkey: process.env.MSG91_TOKEN,
        },
        body: JSON.stringify(payload),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.log("MSG91 EMAIL ERROR:", data);
      throw new Error(data.message || "Failed to send email via MSG91");
    }

    if (data.type === "error") {
      throw new Error(data.message || "Email sending failed");
    }

    return data;
  } catch (error) {
    console.log("EMAIL ERROR:", error.message);
    throw error;
  }
};


module.exports = sendEmail;
