import mongoose from "mongoose";

const bookingSchema = new mongoose.Schema({
  bookingNumber: { 
    type: String, 
    unique: true, 
    required: true 
  },
  restaurantId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Restaurant', 
    required: true, 
    index: true 
  },
  customerId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true, 
    index: true 
  },
  tableId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Table', 
    required: true 
  },
  bookingDate: { 
    type: Date, 
    required: true,
    description: "The full ISO date and time for the start of the booking slot."
  },
  guests: { 
    type: Number, 
    required: true, 
    min: 1 
  },
  status: {
    type: String,
    enum: ['confirmed', 'cancelled_by_user', 'cancelled_by_owner', 'completed'],
    default: 'confirmed',
    required: true
  },
  paymentDetails: {
    sessionId: { type: String, index: true, required: true },
    paymentStatus: { type: String, enum: ['paid', 'refunded'], default: 'paid' },
    bookingFee: { type: Number, required: true }
  },
  notes: { 
    type: String, 
    trim: true 
  },
}, { timestamps: true });

// Ensures a single table cannot be double-booked for the exact same time.
bookingSchema.index({ tableId: 1, bookingDate: 1 }, { unique: true, partialFilterExpression: { status: 'confirmed' } });


export default mongoose.model("Booking", bookingSchema);