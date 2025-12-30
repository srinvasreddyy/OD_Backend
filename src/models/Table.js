import mongoose from "mongoose";

/**
 * @description Represents a dining table configuration for a specific date.
 * Now acts as "Inventory" for a specific day.
 */
const tableSchema = new mongoose.Schema({
  restaurantId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "Restaurant", 
    required: true, 
    index: true 
  },
  tableNumber: { 
    type: String, 
    required: [true, "Table number is required."], 
    trim: true 
  },
  capacity: { 
    type: Number, 
    required: [true, "Table capacity is required."], 
    min: [1, "Capacity must be at least 1."] 
  },
  area: { 
    type: String, 
    trim: true, 
    default: 'General'
  },
  // --- INVENTORY FIELDS ---
  date: {
    type: Date,
    required: [true, "Date is required for table availability."],
    index: true
  },
  availableHours: [{
    type: String, // Format: "HH:MM" (e.g., "10:00", "11:00")
    required: true
  }],
  bookingPrice: {
    type: Number,
    required: true,
    default: 0,
    min: 0,
    description: "Flat fee for booking this table, regardless of duration."
  },
  maxBookingHours: {
    type: Number,
    required: true,
    default: 2,
    min: 1,
    description: "Maximum number of sequential hours a user can book."
  },
  isActive: { 
    type: Boolean, 
    default: true
  },
}, { 
  timestamps: true 
});

// Compound index: Unique table number per restaurant PER DATE.
tableSchema.index({ restaurantId: 1, tableNumber: 1, date: 1 }, { unique: true });

export default mongoose.model("Table", tableSchema);