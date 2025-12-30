import mongoose from "mongoose";

const bookingSchema = new mongoose.Schema({
  bookingNumber: { 
    type: String, 
    required: true, 
    unique: true 
  },
  restaurantId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "Restaurant", 
    required: true,
    index: true
  },
  customerId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "User", 
    required: true,
    index: true
  },
  tableId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "Table", 
    required: true 
  },
  bookingDate: { 
    type: Date, 
    required: true,
    index: true 
  },
  // --- NEW FIELD ---
  bookedSlots: [{
    type: String, // Format: "HH:MM"
    required: true
  }],
  guests: { 
    type: Number, 
    required: true, 
    min: 1 
  },
  status: { 
    type: String, 
    enum: ['pending', 'confirmed', 'cancelled_by_user', 'cancelled_by_owner', 'completed'], 
    default: 'pending' 
  },
  paymentDetails: {
    sessionId: { type: String },
    paymentStatus: { type: String, enum: ['pending', 'paid', 'refunded', 'failed'], default: 'pending' },
    bookingFee: { type: Number, default: 0 }
  },
  specialRequests: {
    type: String,
    trim: true
  }
}, { 
  timestamps: true 
});

export default mongoose.model("Booking", bookingSchema);