import mongoose from "mongoose";

/**
 * @description Represents a single dining table in a restaurant.
 * Availability and slots are determined dynamically, not stored here.
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
    default: 'General',
    description: "The area of the restaurant where the table is located, e.g., 'Patio', 'Rooftop', 'Main Hall'."
  },
  isActive: { 
    type: Boolean, 
    default: true,
    description: "Indicates if the table is currently in service and available for booking."
  },
}, { 
  timestamps: true 
});

// Ensures that no two tables in the same restaurant can have the same number.
tableSchema.index({ restaurantId: 1, tableNumber: 1 }, { unique: true });

export default mongoose.model("Table", tableSchema);