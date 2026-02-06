import PDFDocument from 'pdfkit';

const formatCurrency = (amount) => `GBP ${Number(amount || 0).toFixed(2)}`;

export const generateInvoicePDF = (transaction) => {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ margin: 50 });
            const buffers = [];

            doc.on('data', buffers.push.bind(buffers));
            doc.on('end', () => resolve(Buffer.concat(buffers)));

            // Determine Transaction Type
            const isBooking = !!transaction.bookingNumber; 
            const refNumber = isBooking ? transaction.bookingNumber : transaction.orderNumber;
            const date = isBooking ? transaction.bookingDate : transaction.createdAt;
            
            // Resolve Customer Name
            let customerName = "Guest";
            if (transaction.customerDetails && transaction.customerDetails.name) {
                customerName = transaction.customerDetails.name;
            } else if (transaction.customerId && transaction.customerId.fullName) {
                customerName = transaction.customerId.fullName;
            }

            // --- HEADER ---
            doc.fillColor('#444444')
               .fontSize(20)
               .text('TAX INVOICE', 50, 57)
               .fontSize(10)
               .text('OrderNow Platform', 200, 50, { align: 'right' })
               .text('123 Innovation Drive', 200, 65, { align: 'right' })
               .text('London, UK', 200, 80, { align: 'right' })
               .moveDown();

            doc.strokeColor("#aaaaaa").lineWidth(1).moveTo(50, 100).lineTo(550, 100).stroke();

            // --- INVOICE DETAILS ---
            const customerTop = 115;
            doc.fontSize(10)
               .text(`Invoice #: ${refNumber}`, 50, customerTop)
               .text(`Date: ${new Date(date).toLocaleDateString()}`, 50, customerTop + 15)
               .text(`Type: ${isBooking ? 'Table Reservation' : (transaction.orderType === 'pickup' ? 'Self Pickup' : 'Delivery')}`, 50, customerTop + 30)
               .text(`Payment: ${isBooking ? 'Online (Card)' : transaction.paymentType.toUpperCase()}`, 50, customerTop + 45);

            // --- CUSTOMER DETAILS ---
            doc.font('Helvetica-Bold').text('Billed To:', 300, customerTop)
               .font('Helvetica').text(customerName, 300, customerTop + 15);
            
            if (!isBooking && transaction.deliveryAddress) {
                doc.text(transaction.deliveryAddress.fullAddress || "Pickup Order", 300, customerTop + 30);
            }

            doc.moveDown();
            
            // --- RESTAURANT DETAILS ---
            doc.font('Helvetica-Bold').text(`Vendor: ${transaction.restaurantId?.restaurantName || "Restaurant"}`, 50, customerTop + 80);
            if(transaction.restaurantId?.address) {
                doc.font('Helvetica').text(`${transaction.restaurantId.address.area}, ${transaction.restaurantId.address.city}`, 50, customerTop + 95);
            }

            // --- TABLE LAYOUT ---
            const tableTop = 250;
            doc.font('Helvetica-Bold');
            
            if (isBooking) {
                doc.text("Description", 50, tableTop)
                   .text("Date", 250, tableTop)
                   .text("Time Slots", 350, tableTop)
                   .text("Amount", 450, tableTop, { align: 'right' });
            } else {
                doc.text("Item", 50, tableTop)
                   .text("Unit Price", 280, tableTop, { align: 'right' })
                   .text("Qty", 370, tableTop, { align: 'right' })
                   .text("Total", 0, tableTop, { align: 'right' });
            }

            doc.strokeColor("#aaaaaa").lineWidth(1).moveTo(50, tableTop + 15).lineTo(550, tableTop + 15).stroke();
            doc.font('Helvetica');

            let position = tableTop + 30;

            if (isBooking) {
                // RENDER BOOKING
                const slots = transaction.bookedSlots ? transaction.bookedSlots.join(', ') : 'N/A';
                const bookingFee = transaction.paymentDetails?.bookingFee || 0;
                
                doc.text(`Table ${transaction.tableId?.tableNumber || 'N/A'} Reservation`, 50, position)
                   .text(new Date(transaction.bookingDate).toLocaleDateString(), 250, position)
                   .text(slots, 350, position)
                   .text(formatCurrency(bookingFee), 0, position, { align: 'right' });
                
                position += 30;
            } else {
                // RENDER ORDER ITEMS
                transaction.orderedItems.forEach((item) => {
                    if (position > 700) { doc.addPage(); position = 50; } // Auto-Pagination
                    
                    doc.text(item.itemName, 50, position, { width: 220 })
                       .text(formatCurrency(item.price), 280, position, { width: 90, align: 'right' })
                       .text(item.quantity, 370, position, { width: 90, align: 'right' })
                       .text(formatCurrency(item.itemTotal), 0, position, { align: 'right' });
                    position += 20;
                });
            }

            // --- SUMMARY SECTION ---
            const subtotalPos = position + 30;
            doc.strokeColor("#aaaaaa").lineWidth(1).moveTo(50, subtotalPos - 10).lineTo(550, subtotalPos - 10).stroke();

            if (isBooking) {
                const total = transaction.paymentDetails?.bookingFee || 0;
                doc.font('Helvetica-Bold').fontSize(12)
                   .text("Grand Total", 300, subtotalPos + 20, { align: 'right' })
                   .text(formatCurrency(total), 0, subtotalPos + 20, { align: 'right' });
            } else {
                const p = transaction.pricing;
                doc.text("Subtotal", 350, subtotalPos, { align: 'right' }).text(formatCurrency(p.subtotal), 0, subtotalPos, { align: 'right' });
                doc.text("Handling Fee", 350, subtotalPos + 15, { align: 'right' }).text(formatCurrency(p.handlingCharge), 0, subtotalPos + 15, { align: 'right' });
                doc.text("Delivery Fee", 350, subtotalPos + 30, { align: 'right' }).text(formatCurrency(p.deliveryFee), 0, subtotalPos + 30, { align: 'right' });
                
                if (p.discountAmount > 0) {
                    doc.fillColor('green')
                       .text("Discount", 350, subtotalPos + 45, { align: 'right' })
                       .text(`-${formatCurrency(p.discountAmount)}`, 0, subtotalPos + 45, { align: 'right' })
                       .fillColor('black');
                }

                doc.font('Helvetica-Bold').fontSize(12)
                   .text("Grand Total", 350, subtotalPos + 70, { align: 'right' })
                   .text(formatCurrency(p.totalAmount), 0, subtotalPos + 70, { align: 'right' });
            }

            // --- FOOTER ---
            doc.fontSize(10).font('Helvetica')
               .text("Thank you for your business. For support, contact help@ordernow.com", 50, 700, { align: "center", width: 500 });

            doc.end();
        } catch (error) {
            reject(error);
        }
    });
};