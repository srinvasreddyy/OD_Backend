import PDFDocument from 'pdfkit';

const formatCurrency = (amount) => `GBP ${Number(amount || 0).toFixed(2)}`;

export const generateInvoicePDF = (transaction) => {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ margin: 50, size: 'A4', bufferPages: true });
            const buffers = [];

            doc.on('data', buffers.push.bind(buffers));
            doc.on('end', () => resolve(Buffer.concat(buffers)));

            // --- DATA PREPARATION ---
            const isBooking = !!transaction.bookingNumber || (transaction.bookedSlots && transaction.bookedSlots.length > 0);
            
            const refNumber = isBooking 
                ? (transaction.bookingNumber || `BK-${transaction._id.toString().slice(-6).toUpperCase()}`)
                : (transaction.orderNumber || `ORD-${transaction._id.toString().slice(-6).toUpperCase()}`);
                
            const transactionDate = isBooking 
                ? (transaction.bookingDate || transaction.createdAt) 
                : transaction.createdAt;

            // Customer Info
            let customerName = "Guest Customer";
            let customerEmail = "";
            let customerPhone = "";
            if (transaction.customerDetails) {
                customerName = transaction.customerDetails.name || customerName;
                customerEmail = transaction.customerDetails.email || "";
                customerPhone = transaction.customerDetails.phoneNumber || "";
            } else if (transaction.customerId) {
                customerName = transaction.customerId.fullName || customerName;
                customerEmail = transaction.customerId.email || "";
                customerPhone = transaction.customerId.phoneNumber || "";
            }

            // --- LAYOUT HELPERS ---
            const pageBottom = 750;
            const tableLeft = 50;
            const colDesc = 50;
            const colPrice = 300;
            const colQty = 380;
            const colTotal = 450;
            const colWidthDesc = 240;

            const checkPageBreak = (currentY, neededHeight = 20) => {
                if (currentY + neededHeight > pageBottom) {
                    doc.addPage();
                    drawTableHeader(50); // Redraw header on new page
                    return 80; // Return new Y position
                }
                return currentY;
            };

            const drawTableHeader = (y) => {
                doc.rect(tableLeft, y, 500, 25).fill('#f3f4f6');
                doc.fillColor('#111827').font('Helvetica-Bold').fontSize(9);
                if (isBooking) {
                    doc.text("DESCRIPTION", colDesc + 10, y + 8)
                       .text("DATE", 250, y + 8)
                       .text("SLOTS", 350, y + 8)
                       .text("AMOUNT", colTotal, y + 8, { align: 'right', width: 50 });
                } else {
                    doc.text("ITEM DESCRIPTION", colDesc + 10, y + 8)
                       .text("UNIT PRICE", colPrice, y + 8, { align: 'right', width: 70 })
                       .text("QTY", colQty, y + 8, { align: 'right', width: 40 })
                       .text("TOTAL", colTotal, y + 8, { align: 'right', width: 50 });
                }
            };

            // --- 1. HEADER ---
            doc.fillColor('#1f2937').fontSize(24).font('Helvetica-Bold').text('INVOICE', 50, 50);
            
            doc.fontSize(10).font('Helvetica').fillColor('#6b7280')
               .text('OrderNow Platform', 200, 50, { align: 'right' })
               .text('support@ordernow.com', 200, 65, { align: 'right' });

            doc.moveDown();
            doc.strokeColor("#e5e7eb").lineWidth(1).moveTo(50, 90).lineTo(550, 90).stroke();

            // --- 2. INFO COLUMNS ---
            let y = 110;
            const colRightStart = 350;

            // Left: Billed To & Shipped To
            doc.fontSize(10).fillColor('#9ca3af').font('Helvetica-Bold').text('BILLED TO:', 50, y);
            doc.fillColor('#111827').font('Helvetica').text(customerName, 50, y + 15);
            let leftY = y + 30;
            if (customerPhone) { doc.text(customerPhone, 50, leftY); leftY += 15; }
            if (customerEmail) { doc.text(customerEmail, 50, leftY); leftY += 15; }

            if (!isBooking && transaction.deliveryAddress) {
                leftY += 10;
                doc.fillColor('#9ca3af').font('Helvetica-Bold').text('SHIPPED TO:', 50, leftY);
                leftY += 15;
                const addr = transaction.deliveryAddress;
                const fullAddr = addr.fullAddress || addr.addressLine1 || "Self Pickup";
                const landmark = addr.landmark ? `\nLandmark: ${addr.landmark}` : "";
                
                doc.fillColor('#4b5563').font('Helvetica')
                   .text(fullAddr + landmark, 50, leftY, { width: 250, align: 'left' });
                
                // Calculate height of address to update leftY
                leftY += doc.heightOfString(fullAddr + landmark, { width: 250 }) + 10;
            }

            // Right: Invoice Meta
            doc.fillColor('#9ca3af').font('Helvetica-Bold').text('DETAILS:', colRightStart, y);
            let rightY = y + 15;
            
            const metaRow = (label, value) => {
                doc.fillColor('#4b5563').font('Helvetica-Bold').text(label, colRightStart, rightY);
                doc.font('Helvetica').text(value, colRightStart + 80, rightY, { align: 'right', width: 120 });
                rightY += 15;
            };

            metaRow('Ref No:', refNumber);
            metaRow('Date:', new Date(transactionDate).toLocaleDateString());
            if (!isBooking) metaRow('Order Type:', (transaction.orderType || '').toUpperCase().replace('_', ' '));
            metaRow('Payment:', (transaction.paymentType || 'Card').toUpperCase());
            metaRow('Status:', (transaction.paymentStatus || 'Paid').toUpperCase());

            // --- 3. ITEMS TABLE ---
            // Start table below the lowest column (Left or Right)
            y = Math.max(leftY, rightY) + 20;
            
            drawTableHeader(y);
            y += 35; // Move below header

            doc.font('Helvetica').fontSize(9).fillColor('#374151');

            if (isBooking) {
                // BOOKING ROW
                const slots = transaction.bookedSlots ? transaction.bookedSlots.join(', ') : 'Standard Slot';
                const bookingFee = transaction.paymentDetails?.bookingFee || 0;
                const dateStr = new Date(transaction.bookingDate).toLocaleDateString();
                const desc = `Table Reservation - Table ${transaction.tableId?.tableNumber || 'N/A'}`;

                doc.text(desc, colDesc + 10, y)
                   .text(dateStr, 250, y)
                   .text(slots, 350, y, { width: 90 })
                   .text(formatCurrency(bookingFee), colTotal, y, { align: 'right', width: 50 });
                
                y += 30;
            } else {
                // ORDER ROWS
                if (transaction.orderedItems && Array.isArray(transaction.orderedItems)) {
                    transaction.orderedItems.forEach((item) => {
                        // Prepare Description Text
                        let descText = item.itemName;
                        let metaText = "";

                        if (item.selectedVariants?.length) {
                            metaText += "\n" + item.selectedVariants.map(v => `${v.groupTitle}: ${v.variantName}`).join(', ');
                        }
                        if (item.selectedAddons?.length) {
                            metaText += "\nAdd-ons: " + item.selectedAddons.map(a => `${a.optionTitle}`).join(', ');
                        }
                        if (item.instructions) {
                            metaText += `\nNote: ${item.instructions}`;
                        }

                        // Calculate total height needed for this item row
                        const descHeight = doc.heightOfString(descText, { width: colWidthDesc });
                        const metaHeight = metaText ? doc.heightOfString(metaText, { width: colWidthDesc }) : 0;
                        const rowHeight = descHeight + metaHeight + 15; // +padding

                        // Check Page Break
                        y = checkPageBreak(y, rowHeight);

                        // Print Row
                        const unitPrice = item.price || item.basePrice || 0;
                        const itemTotal = item.itemTotal || 0;

                        // 1. Description (Black)
                        doc.fillColor('#111827').font('Helvetica-Bold').text(descText, colDesc + 10, y, { width: colWidthDesc });
                        
                        // 2. Meta (Gray)
                        if (metaText) {
                            doc.fillColor('#6b7280').font('Helvetica').fontSize(8)
                               .text(metaText, colDesc + 10, y + descHeight, { width: colWidthDesc });
                        }

                        // 3. Numbers (Aligned Top)
                        doc.fillColor('#374151').font('Helvetica').fontSize(9)
                           .text(formatCurrency(unitPrice), colPrice, y, { align: 'right', width: 70 })
                           .text(item.quantity, colQty, y, { align: 'right', width: 40 })
                           .text(formatCurrency(itemTotal), colTotal, y, { align: 'right', width: 50 });

                        // Update Y
                        y += rowHeight;
                    });
                }
            }

            // --- 4. SUMMARY SECTION ---
            y += 10;
            y = checkPageBreak(y, 150); // Ensure enough space for summary

            doc.strokeColor("#e5e7eb").lineWidth(1).moveTo(colPrice, y).lineTo(550, y).stroke();
            y += 15;

            const printSummaryRow = (label, value, isBold = false, color = '#374151') => {
                doc.font(isBold ? 'Helvetica-Bold' : 'Helvetica')
                   .fillColor(color)
                   .fontSize(isBold ? 11 : 9)
                   .text(label, colPrice, y)
                   .text(value, colTotal, y, { align: 'right', width: 50 });
                y += 18;
            };

            if (isBooking) {
                const total = transaction.paymentDetails?.bookingFee || 0;
                printSummaryRow("Grand Total", formatCurrency(total), true, '#111827');
            } else {
                const p = transaction.pricing || {};
                
                // Only show fields that exist and are greater than 0
                if (p.subtotal) printSummaryRow("Subtotal", formatCurrency(p.subtotal));
                if (p.handlingCharge) printSummaryRow("Handling Fee", formatCurrency(p.handlingCharge));
                if (p.deliveryFee) printSummaryRow("Delivery Fee", formatCurrency(p.deliveryFee));
                if (p.platformFee) printSummaryRow("Platform Fee", formatCurrency(p.platformFee));
                if (p.discountAmount) printSummaryRow("Discount", `-${formatCurrency(p.discountAmount)}`, false, '#059669');

                y += 5;
                doc.strokeColor("#e5e7eb").lineWidth(1).moveTo(colPrice, y - 10).lineTo(550, y - 10).stroke();
                
                // Final Total (No assumed VAT)
                printSummaryRow("Grand Total", formatCurrency(p.totalAmount || 0), true, '#111827');
            }

            // --- 5. NOTES & FOOTER ---
            y += 30;
            y = checkPageBreak(y, 60);

            // Order Notes
            if (transaction.notes) {
                doc.fillColor('#1f2937').font('Helvetica-Bold').fontSize(10).text("Additional Notes:", 50, y);
                y += 15;
                doc.fillColor('#4b5563').font('Helvetica').fontSize(9).text(transaction.notes, 50, y, { width: 500 });
                y += doc.heightOfString(transaction.notes, { width: 500 }) + 20;
            }

            // Vendor Info
            if (transaction.restaurantId) {
                const rName = transaction.restaurantId.restaurantName || "Restaurant Partner";
                const rAddr = transaction.restaurantId.address ? `${transaction.restaurantId.address.area}, ${transaction.restaurantId.address.city}` : "";
                
                doc.fontSize(8).fillColor('#9ca3af')
                   .text(`Fulfilled by: ${rName} | ${rAddr}`, 50, 710, { align: 'center' });
            }

            doc.fontSize(8).fillColor('#9ca3af')
               .text("Thank you for your business.", 50, 725, { align: 'center' })
               .text(`Generated on ${new Date().toLocaleString()}`, 50, 740, { align: 'center' });

            doc.end();

        } catch (error) {
            reject(error);
        }
    });
};