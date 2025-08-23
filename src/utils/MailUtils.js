import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

const transporter = nodemailer.createTransport({
  service: 'gmail', 
  
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  }
});

export const sendOTPEmail = async (email, otp) => {
  const htmlContent = `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>OTP for Login</title>
    <style>
      body {
        font-family: Arial, sans-serif;
        background-color: #f9f9f9;
        margin: 0;
        padding: 20px;
      }
      .container {
        max-width: 600px;
        margin: 0 auto;
        background: #ffffff;
        padding: 30px 25px;
        border-radius: 8px;
        box-shadow: 0 2px 6px rgba(0,0,0,0.12);
        color: #333333;
      }
      h2 {
        margin-top: 0;
        color: #2c3e50;
      }
      p {
        font-size: 16px;
        line-height: 1.5;
        color: #555555;
        margin: 12px 0;
      }
      .otp-code {
        display: inline-block;
        background-color: #f0f0f0;
        padding: 10px 16px;
        border-radius: 6px;
        font-weight: 700;
        font-size: 20px;
        color: #222222;
        letter-spacing: 2px;
      }
      .info-text {
        font-size: 14px;
        color: #888888;
      }
      hr {
        border: none;
        border-top: 1px solid #eeeeee;
        margin: 30px 0;
      }
      .footer-text {
        font-size: 12px;
        color: #aaaaaa;
        text-align: center;
      }
      @media (max-width: 480px) {
        .container {
          padding: 20px 15px;
        }
        .otp-code {
          font-size: 18px;
          padding: 8px 14px;
        }
      }
    </style>
  </head>
  <body>
    <div class="container">
      <h2>Your OTP for Login</h2>
      <p>Dear user,</p>
      <p>
        Your OTP is:
        <span class="otp-code">${otp}</span>
      </p>
      <p class="info-text">
        Please use this OTP to complete your login. It will expire in 5 minutes.
      </p>
      <hr />
      <p class="footer-text">
        If you did not request this code, please ignore this email.
      </p>
    </div>
  </body>
  </html>
  `;

  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: email,
    subject: 'Your OTP Code',
    html: htmlContent,
  };

  await transporter.sendMail(mailOptions);
};
