import PDFDocument from 'pdfkit';

const formatCurrency = (amount) => `GBP ${Number(amount || 0).toFixed(2)}`;

export const generateInvoicePDF = (transaction) => {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ margin: 50, size: 'A4' });
            const buffers = [];

            doc.on('data', buffers.push.bind(buffers));
            doc.on('end', () => resolve(Buffer.concat(buffers)));

            // --- 1. DETERMINE TRANSACTION TYPE & SAFE DATA ---
            // Detect if this is a Booking or an Order
            const isBooking = !!transaction.bookingNumber || (transaction.bookedSlots && transaction.bookedSlots.length > 0);
            
            // Safe Reference Number
            const refNumber = isBooking 
                ? (transaction.bookingNumber || `BK-${transaction._id.toString().slice(-6).toUpperCase()}`)
                : (transaction.orderNumber || `ORD-${transaction._id.toString().slice(-6).toUpperCase()}`);
                
            // Safe Date
            const transactionDate = isBooking 
                ? (transaction.bookingDate || transaction.createdAt) 
                : transaction.createdAt;

            // Safe Customer Details
            let customerName = "Guest Customer";
            let customerEmail = "";
            let customerPhone = "";

            if (transaction.customerDetails) {
                customerName = transaction.customerDetails.name || customerName;
                customerEmail = transaction.customerDetails.email || "";
                customerPhone = transaction.customerDetails.phoneNumber || "";
            } 
            // Fallback to populated ID
            if (customerName === "Guest Customer" && transaction.customerId && transaction.customerId.fullName) {
                customerName = transaction.customerId.fullName;
                customerEmail = transaction.customerId.email || "";
                customerPhone = transaction.customerId.phoneNumber || "";
            }

            // --- 2. HEADER ---
            doc.fillColor('#1f2937')
               .fontSize(24)
               .font('Helvetica-Bold')
               .text('INVOICE', 50, 50);

            doc.fontSize(10)
               .font('Helvetica')
               .fillColor('#6b7280')
               .text('OrderNow Platform', 200, 50, { align: 'right' })
               .text('123 Innovation Drive', 200, 65, { align: 'right' })
               .text('London, UK, SW1A 1AA', 200, 80, { align: 'right' })
               .text('support@ordernow.com', 200, 95, { align: 'right' });

            doc.moveDown();
            doc.strokeColor("#e5e7eb").lineWidth(1).moveTo(50, 115).lineTo(550, 115).stroke();

            // --- 3. DETAILS GRID ---
            const gridTop = 130;
            const col2 = 300;

            // Left Column: Billed To
            doc.fontSize(10).fillColor('#9ca3af').font('Helvetica-Bold').text('BILLED TO:', 50, gridTop);
            doc.fillColor('#111827').font('Helvetica').text(customerName, 50, gridTop + 15);
            
            if (customerPhone) {
                doc.text(customerPhone, 50, gridTop + 30);
            }
            if (customerEmail) {
                doc.text(customerEmail, 50, gridTop + 45);
            }

            // Delivery Address (only for orders)
            if (!isBooking && transaction.deliveryAddress) {
                const addr = transaction.deliveryAddress;
                const addrStr = addr.fullAddress || addr.addressLine1 || "Self Pickup / Dine-in";
                const landmark = addr.landmark ? ` (Landmark: ${addr.landmark})` : "";
                
                doc.moveDown();
                doc.fillColor('#9ca3af').font('Helvetica-Bold').text('SHIPPING ADDRESS:', 50, doc.y);
                doc.fillColor('#4b5563').font('Helvetica').text(addrStr + landmark, 50, doc.y + 5, { width: 220 });
            }

            // Right Column: Invoice Meta
            doc.fillColor('#9ca3af').font('Helvetica-Bold').text('INVOICE DETAILS:', col2, gridTop);
            
            doc.fillColor('#4b5563').font('Helvetica-Bold').text('Invoice No:', col2, gridTop + 15);
            doc.font('Helvetica').text(refNumber, col2 + 80, gridTop + 15, { align: 'right' });

            doc.font('Helvetica-Bold').text('Date:', col2, gridTop + 30);
            doc.font('Helvetica').text(new Date(transactionDate).toLocaleDateString(), col2 + 80, gridTop + 30, { align: 'right' });

            doc.font('Helvetica-Bold').text('Status:', col2, gridTop + 45);
            doc.font('Helvetica').fillColor('#059669').text('PAID', col2 + 80, gridTop + 45, { align: 'right' });

            doc.fillColor('#4b5563').font('Helvetica-Bold').text('Payment:', col2, gridTop + 60);
            const payType = (transaction.paymentType || 'Card').toUpperCase();
            doc.font('Helvetica').text(payType, col2 + 80, gridTop + 60, { align: 'right' });

            // Vendor Details (below grid)
            const vendorTop = 210;
            doc.fillColor('#9ca3af').font('Helvetica-Bold').text('VENDOR:', 50, vendorTop);
            doc.fillColor('#111827').font('Helvetica-Bold').text(transaction.restaurantId?.restaurantName || "Restaurant Partner", 50, vendorTop + 15);
            if (transaction.restaurantId?.address) {
                const rAddr = transaction.restaurantId.address;
                doc.font('Helvetica').text(`${rAddr.area || ''}, ${rAddr.city || ''}`, 50, vendorTop + 30);
            }

            // --- 4. ITEMS TABLE ---
            const tableTop = 270;
            doc.rect(50, tableTop, 500, 25).fill('#f3f4f6');
            doc.fillColor('#111827').font('Helvetica-Bold').fontSize(9);
            
            if (isBooking) {
                doc.text("DESCRIPTION", 60, tableTop + 8)
                   .text("DATE", 250, tableTop + 8)
                   .text("SLOTS", 350, tableTop + 8)
                   .text("AMOUNT", 450, tableTop + 8, { align: 'right' });
            } else {
                doc.text("ITEM DESCRIPTION", 60, tableTop + 8)
                   .text("UNIT PRICE", 300, tableTop + 8, { align: 'right' })
                   .text("QTY", 380, tableTop + 8, { align: 'right' })
                   .text("TOTAL", 500, tableTop + 8, { align: 'right' });
            }

            // --- 5. RENDER ROWS ---
            let position = tableTop + 35;
            doc.font('Helvetica').fontSize(9).fillColor('#374151');

            if (isBooking) {
                // Booking Row
                const slots = transaction.bookedSlots ? transaction.bookedSlots.join(', ') : 'Standard Slot';
                const bookingFee = transaction.paymentDetails?.bookingFee || 0;
                
                doc.text(`Table Reservation - Table ${transaction.tableId?.tableNumber || 'N/A'}`, 60, position)
                   .text(new Date(transaction.bookingDate).toLocaleDateString(), 250, position)
                   .text(slots, 350, position)
                   .text(formatCurrency(bookingFee), 450, position, { align: 'right' });
                
                position += 20;
            } else {
                // Order Rows
                if (transaction.orderedItems && Array.isArray(transaction.orderedItems)) {
                    transaction.orderedItems.forEach((item) => {
                        // Pagination Check
                        if (position > 700) { 
                            doc.addPage(); 
                            position = 50; 
                            // Redraw Header on new page
                            doc.rect(50, position, 500, 25).fill('#f3f4f6');
                            doc.fillColor('#111827').font('Helvetica-Bold').fontSize(9);
                            doc.text("ITEM DESCRIPTION", 60, position + 8)
                               .text("UNIT PRICE", 300, position + 8, { align: 'right' })
                               .text("QTY", 380, position + 8, { align: 'right' })
                               .text("TOTAL", 500, position + 8, { align: 'right' });
                            position += 35;
                            doc.font('Helvetica').fontSize(9).fillColor('#374151');
                        }
                        
                        // Main Item Line
                        const itemTotal = item.itemTotal || 0;
                        const unitPrice = item.price || item.basePrice || 0;

                        doc.text(item.itemName, 60, position, { width: 220, ellipsis: true })
                           .text(formatCurrency(unitPrice), 300, position, { width: 50, align: 'right' })
                           .text(item.quantity, 380, position, { width: 30, align: 'right' })
                           .text(formatCurrency(itemTotal), 450, position, { align: 'right', width: 50 });
                        
                        position += 20;

                        // Variants / Addons Line
                        let extras = [];
                        if (item.selectedVariants && Array.isArray(item.selectedVariants)) {
                            item.selectedVariants.forEach(v => extras.push(`${v.groupTitle}: ${v.variantName}`));
                        }
                        if (item.selectedAddons && Array.isArray(item.selectedAddons)) {
                            item.selectedAddons.forEach(a => extras.push(`+ ${a.optionTitle}`));
                        }

                        if (extras.length > 0) {
                            doc.fontSize(8).fillColor('#9ca3af')
                               .text(extras.join(', '), 60, position, { width: 220 });
                            doc.fontSize(9).fillColor('#374151');
                            position += (10 * Math.ceil(extras.join(', ').length / 60)) + 5;
                        }
                    });
                }
            }

            // --- 6. SUMMARY FOOTER ---
            const summaryStart = position + 20;
            doc.strokeColor("#e5e7eb").lineWidth(1).moveTo(300, summaryStart).lineTo(550, summaryStart).stroke();
            
            let y = summaryStart + 15;
            
            const printSummaryRow = (label, value, isBold = false, isGreen = false) => {
                doc.font(isBold ? 'Helvetica-Bold' : 'Helvetica')
                   .fillColor(isGreen ? '#059669' : '#374151')
                   .fontSize(isBold ? 11 : 9)
                   .text(label, 300, y)
                   .text(value, 450, y, { align: 'right' });
                y += 18;
            };

            if (isBooking) {
                const total = transaction.paymentDetails?.bookingFee || 0;
                printSummaryRow("Subtotal", formatCurrency(total));
                // Mock Tax for display
                const tax = total * 0.2;
                printSummaryRow("VAT (20%)", formatCurrency(tax));
                y += 5;
                doc.strokeColor("#e5e7eb").lineWidth(1).moveTo(300, y - 10).lineTo(550, y - 10).stroke();
                printSummaryRow("Grand Total", formatCurrency(total), true);
            } else {
                const p = transaction.pricing || {};
                const sub = p.subtotal || 0;
                const del = p.deliveryFee || 0;
                const hnd = p.handlingCharge || 0;
                const disc = p.discountAmount || 0;
                const total = p.totalAmount || 0;

                printSummaryRow("Subtotal", formatCurrency(sub));
                printSummaryRow("Handling Fee", formatCurrency(hnd));
                printSummaryRow("Delivery Fee", formatCurrency(del));
                
                if (disc > 0) {
                    printSummaryRow("Discount", `-${formatCurrency(disc)}`, false, true);
                }

                // Calculate implied tax (assuming it's included in subtotal for restaurants often)
                const impliedTax = (sub * 0.2).toFixed(2);
                printSummaryRow("VAT (Included 20%)", formatCurrency(impliedTax));

                y += 5;
                doc.strokeColor("#e5e7eb").lineWidth(1).moveTo(300, y - 10).lineTo(550, y - 10).stroke();
                printSummaryRow("Grand Total", formatCurrency(total), true);
            }

            // --- 7. FOOTER ---
            const footerTop = 720;
            doc.fontSize(8).fillColor('#9ca3af').text("Thank you for your business.", 50, footerTop, { align: 'center' });
            doc.text("If you have any questions about this invoice, please contact support@ordernow.com", 50, footerTop + 12, { align: 'center' });
            doc.text(`Generated on ${new Date().toLocaleString()}`, 50, footerTop + 24, { align: 'center' });

            doc.end();
        } catch (error) {
            reject(error);
        }
    });
};