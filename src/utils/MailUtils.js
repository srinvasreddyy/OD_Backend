import nodemailer from 'nodemailer';
import logger from './logger.js';
import config from '../config/env.js';
import { generateInvoicePDF } from './InvoiceGenerator.js';

// HOSTINGER CONFIGURATION CHANGE:
// Hostinger blocks Port 587 (STARTTLS). We must use Port 465 (SSL).
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true, // true for 465, false for other ports
  auth: {
    user: config.email.user,
    pass: config.email.pass,
  }
});

export const sendOTPEmail = async (email, otp) => {
  const htmlContent = `
  <!DOCTYPE html>
  <html>
  <body style="font-family: Arial, sans-serif; padding: 20px; background-color: #f4f4f4;">
    <div style="max-width: 600px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px;">
      <h2 style="color: #2c3e50;">Authentication Required</h2>
      <p>Your OTP code is:</p>
      <div style="background: #eee; padding: 15px; font-size: 24px; font-weight: bold; letter-spacing: 3px; text-align: center;">${otp}</div>
      <p style="font-size: 12px; color: #888; margin-top: 20px;">This code expires in 5 minutes.</p>
    </div>
  </body>
  </html>
  `;

  try {
    // Optional: Verify connection before sending to debug Hostinger connectivity
    // await transporter.verify();

    await transporter.sendMail({
        from: config.email.user,
        to: email,
        subject: 'Your OTP Code',
        html: htmlContent,
    });
    logger.info(`OTP email sent successfully to ${email}`);
  } catch (error) {
    // Log full error stack for debugging on Hostinger logs
    logger.error('OTP email send failed', { email: email, error: error.message, stack: error.stack });
    throw new Error(`Email sending failed: ${error.message}`);
  }
};

export const sendRejectionEmail = async (email, restaurantName, reason) => {
  const htmlContent = `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Application Update</title>
  </head>
  <body>
    <div style="font-family: Arial, sans-serif; padding: 20px;">
      <h2 style="color: #e74c3c;">Application Rejected</h2>
      <p>Dear ${restaurantName},</p>
      <p>We regret to inform you that your application to join OrderNow has been rejected.</p>
      <p><strong>Reason:</strong> ${reason}</p>
      <p>You are welcome to address the issues and apply again.</p>
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

/**
 * Generates and sends an invoice email for Orders or Bookings.
 * This is robustly designed to handle both Cash (post-delivery) and Online (post-payment) scenarios.
 */
export const sendOrderInvoiceEmail = async (transaction) => {
    try {
        // 1. Identify if it is Booking or Order
        const isBooking = !!transaction.bookingNumber || !!(transaction.bookedSlots && transaction.bookedSlots.length > 0);
        
        const refNum = isBooking 
            ? (transaction.bookingNumber || transaction._id) 
            : (transaction.orderNumber || transaction._id);
        
        // 2. Resolve Email (Try customerDetails first, then populated customerId)
        let targetEmail = null;
        if (transaction.customerDetails && transaction.customerDetails.email) {
            targetEmail = transaction.customerDetails.email;
        } else if (transaction.customerId && transaction.customerId.email) {
            targetEmail = transaction.customerId.email;
        }

        if (!targetEmail) {
            logger.warn(`Invoice generation skipped: No valid email found for transaction ${refNum}`);
            return;
        }

        // 3. Generate the PDF
        const pdfBuffer = await generateInvoicePDF(transaction);

        // 4. Content Construction
        const subject = isBooking 
            ? `Reservation Confirmed: ${refNum}` 
            : `Invoice for Order #${refNum}`;

        const customerName = transaction.customerDetails?.name || transaction.customerId?.fullName || 'Customer';
        const totalAmount = isBooking 
            ? (transaction.paymentDetails?.bookingFee || 0) 
            : (transaction.pricing?.totalAmount || 0);

        const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { font-family: 'Helvetica', sans-serif; color: #333; line-height: 1.6; }
                .container { max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 8px; overflow: hidden; }
                .header { background-color: #2563eb; color: white; padding: 20px; text-align: center; }
                .content { padding: 30px; background-color: #fff; }
                .details { background-color: #f8fafc; padding: 15px; border-radius: 6px; margin: 20px 0; }
                .footer { background-color: #f1f5f9; padding: 15px; text-align: center; font-size: 12px; color: #64748b; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h2>${isBooking ? 'Reservation Confirmed' : 'Payment Receipt'}</h2>
                </div>
                <div class="content">
                    <p>Hi ${customerName},</p>
                    <p>Thank you for using OrderNow. Your transaction has been successfully processed.</p>
                    
                    <div class="details">
                        <p><strong>Reference:</strong> ${refNum}</p>
                        <p><strong>Date:</strong> ${new Date().toLocaleDateString()}</p>
                        <p><strong>Total Paid:</strong> GBP ${Number(totalAmount).toFixed(2)}</p>
                    </div>

                    <p>Please find your official tax invoice attached to this email.</p>
                </div>
                <div class="footer">
                    <p>OrderNow Platform | London, UK</p>
                    <p>Automated Email - Please do not reply directly.</p>
                </div>
            </div>
        </body>
        </html>
        `;

        // 5. Send Mail
        await transporter.sendMail({
            from: config.email.user,
            to: targetEmail,
            subject: subject,
            html: htmlContent,
            attachments: [
                {
                    filename: `Invoice_${refNum}.pdf`,
                    content: pdfBuffer,
                    contentType: 'application/pdf'
                }
            ]
        });

        logger.info(`Invoice email successfully sent to ${targetEmail} for ${refNum}`);

    } catch (error) {
        logger.error(`Failed to send invoice email for transaction ${transaction._id}`, { error: error.message });
        // We log but do not throw, to ensure the main order flow doesn't crash if email fails
    }
};