import nodemailer from 'nodemailer';
import logger from './logger.js';
import config from '../config/env.js';
import { generateInvoicePDF } from './InvoiceGenerator.js';

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: config.email.user,
    pass: config.email.pass,
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
    from: config.email.user,
    to: email,
    subject: 'Your OTP Code',
    html: htmlContent,
  };

  try {
    await transporter.sendMail(mailOptions);
    logger.info(`OTP email sent successfully to ${email}`);
  } catch (error) {
    logger.error('OTP email send failed', { email: email, error: error.message });
    throw new Error('Email could not be sent.');
  }
};

export const sendRejectionEmail = async (email, restaurantName, reason) => {
  const htmlContent = `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Application Update</title>
    <style>
      body { font-family: Arial, sans-serif; padding: 20px; background-color: #f9f9f9; }
      .container { max-width: 600px; margin: 0 auto; background: #fff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
      h2 { color: #e74c3c; }
      p { line-height: 1.5; color: #333; }
    </style>
  </head>
  <body>
    <div class="container">
      <h2>Application Rejected</h2>
      <p>Dear ${restaurantName},</p>
      <p>We regret to inform you that your application to join OrderNow has been rejected.</p>
      <p><strong>Reason:</strong> ${reason}</p>
      <p>Your application data has been removed from our system. You are welcome to address the issues mentioned above and apply again.</p>
    </div>
  </body>
  </html>
  `;

  try {
    await transporter.sendMail({
      from: config.email.user,
      to: email,
      subject: 'Update on your OrderNow Application',
      html: htmlContent,
    });
    logger.info(`Rejection email sent to ${email}`);
  } catch (error) {
    logger.error('Failed to send rejection email', { email, error: error.message });
  }
};

export const sendOrderInvoiceEmail = async (order) => {
    try {
        const pdfBuffer = await generateInvoicePDF(order);
        const email = order.customerDetails?.email || order.customerId?.email;
        
        if (!email) {
            // If email isn't in customerDetails, assume caller populated customerId or we need to rely on what is available
             // In Order model, customerId is a ref to User which has email. 
             // Ideally order.customerId.email is available if populated.
             if (!order.customerId || !order.customerId.email) {
                 logger.warn(`No email found for order ${order.orderNumber}, skipping invoice email.`);
                 return;
             }
        }
        
        const targetEmail = email || order.customerId.email;

        const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { font-family: Arial, sans-serif; padding: 20px; color: #333; }
                .header { background-color: #f8f9fa; padding: 20px; border-radius: 8px; }
            </style>
        </head>
        <body>
            <div class="header">
                <h2>Order Receipt #${order.orderNumber}</h2>
                <p>Hi ${order.customerDetails.name},</p>
                <p>Thank you for your order! Your payment has been successfully processed.</p>
                <p>Please find your official invoice attached to this email.</p>
                <br/>
                <p><strong>Total Paid:</strong> GBP ${order.pricing.totalAmount.toFixed(2)}</p>
            </div>
        </body>
        </html>
        `;

        await transporter.sendMail({
            from: config.email.user,
            to: targetEmail,
            subject: `Invoice for Order #${order.orderNumber}`,
            html: htmlContent,
            attachments: [
                {
                    filename: `Invoice_${order.orderNumber}.pdf`,
                    content: pdfBuffer,
                    contentType: 'application/pdf'
                }
            ]
        });

        logger.info(`Invoice email sent to ${targetEmail} for Order ${order.orderNumber}`);

    } catch (error) {
        logger.error("Failed to send invoice email", { orderId: order._id, error: error.message });
    }
};