import mongoose from "mongoose";
import Table from "../models/Table.js";
import logger from "../utils/logger.js";

// Helper to generate hourly slots
const generateSlots = (start, end) => {
    const slots = [];
    const [startH] = start.split(':').map(Number);
    const [endH] = end.split(':').map(Number);
    
    for (let h = startH; h < endH; h++) {
        slots.push(`${String(h).padStart(2, '0')}:00`);
    }
    return slots;
};

/**
 * @description Creates a table availability for a specific date.
 */
export const addTable = async (req, res, next) => {
  try {
    const restaurantId = req.restaurant._id;
    const { tableNumber, capacity, area, date, startTime, endTime, bookingPrice, maxBookingHours } = req.body;

    if (!tableNumber || !capacity || !date || !startTime || !endTime) {
      return res.status(400).json({ success: false, message: "All fields including Date and Time Range are required." });
    }

    // FIX: Strict UTC Date Construction
    const tableDate = new Date(date);
    tableDate.setUTCHours(0, 0, 0, 0); // Force UTC Midnight

    // Validation
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    
    const maxDate = new Date(today);
    maxDate.setDate(today.getDate() + 7);

    if (tableDate < today) {
         return res.status(400).json({ success: false, message: "Cannot add tables for past dates." });
    }
    if (tableDate > maxDate) {
         return res.status(400).json({ success: false, message: "Can only add tables up to 7 days in advance." });
    }

    // Generate Slots
    const availableHours = generateSlots(startTime, endTime);
    if (availableHours.length === 0) {
        return res.status(400).json({ success: false, message: "Invalid time range. End time must be after start time." });
    }

    // Check Uniqueness
    const existingTable = await Table.findOne({ restaurantId, tableNumber, date: tableDate });
    if (existingTable) {
      return res.status(409).json({ success: false, message: `Table ${tableNumber} already exists for ${date}.` });
    }

    const newTable = new Table({
      restaurantId,
      tableNumber,
      capacity,
      area,
      date: tableDate,
      availableHours,
      bookingPrice: Number(bookingPrice) || 0,
      maxBookingHours: Number(maxBookingHours) || 2
    });

    await newTable.save();

    return res.status(201).json({
      success: true,
      message: "Table availability created successfully.",
      data: newTable,
    });
  } catch (error) {
    if (error.name === 'ValidationError') {
        return res.status(400).json({ success: false, message: error.message });
    }
    logger.error("Error adding table", { error: error.message, restaurantId: req.restaurant?._id });
    next(error);
  }
};

/**
 * @description Retrieves active tables for today onwards.
 */
export const getTables = async (req, res, next) => {
    try {
        const restaurantId = req.restaurant._id;
        
        // Filter: Show only tables for Today or Future
        const today = new Date();
        today.setUTCHours(0,0,0,0);

        const tables = await Table.find({ 
            restaurantId,
            date: { $gte: today } 
        }).sort({ date: 1, tableNumber: 1 });

        return res.status(200).json({
            success: true,
            count: tables.length,
            data: tables,
        });
    } catch (error) {
        logger.error("Error fetching tables", { error: error.message });
        next(error);
    }
};

export const getTableById = async (req, res, next) => {
    try {
        const { tableId } = req.params;
        const restaurantId = req.restaurant._id;

        if (!mongoose.Types.ObjectId.isValid(tableId)) {
            return res.status(400).json({ success: false, message: "Invalid table ID format." });
        }

        const table = await Table.findOne({ _id: tableId, restaurantId });
        if (!table) return res.status(404).json({ success: false, message: "Table not found." });

        return res.status(200).json({ success: true, data: table });
    } catch (error) {
        next(error);
    }
};

export const updateTable = async (req, res, next) => {
  try {
    const { tableId } = req.params;
    const restaurantId = req.restaurant._id;
    const { tableNumber, capacity, area, bookingPrice, maxBookingHours } = req.body;

    const table = await Table.findOne({ _id: tableId, restaurantId });
    if (!table) return res.status(404).json({ success: false, message: "Table not found." });

    if (tableNumber) table.tableNumber = tableNumber;
    if (capacity) table.capacity = capacity;
    if (area) table.area = area;
    if (bookingPrice !== undefined) table.bookingPrice = bookingPrice;
    if (maxBookingHours) table.maxBookingHours = maxBookingHours;

    const updatedTable = await table.save();

    return res.status(200).json({
      success: true,
      message: "Table updated successfully.",
      data: updatedTable,
    });
  } catch (error) {
    next(error);
  }
};

export const toggleTableStatus = async (req, res, next) => {
    try {
        const { tableId } = req.params;
        const restaurantId = req.restaurant._id;
        const table = await Table.findOne({ _id: tableId, restaurantId });
        if (!table) return res.status(404).json({ message: "Table not found" });

        table.isActive = !table.isActive;
        await table.save();

        return res.status(200).json({ success: true, data: table });
    } catch (error) {
        next(error);
    }
};

export const deleteTable = async (req, res, next) => {
  try {
    const { tableId } = req.params;
    const restaurantId = req.restaurant._id;
    await Table.deleteOne({ _id: tableId, restaurantId });
    return res.status(200).json({ success: true, message: "Table deleted successfully." });
  } catch (error) {
    next(error);
  }
};