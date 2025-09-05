import mongoose from "mongoose";
import Table from "../models/Table.js";
import logger from "../utils/logger.js";

/**
 * @description Creates a new dining table for the owner's restaurant.
 * @route POST /api/tables
 * @access Private (Restaurant Owner)
 */
export const addTable = async (req, res, next) => {
  try {
    const restaurantId = req.restaurant._id;
    const { tableNumber, capacity, area } = req.body;

    if (!tableNumber || !capacity) {
      return res.status(400).json({ success: false, message: "Table number and capacity are required." });
    }

    const existingTable = await Table.findOne({ restaurantId, tableNumber });
    if (existingTable) {
      return res.status(409).json({ success: false, message: `A table with number '${tableNumber}' already exists.` });
    }

    const newTable = new Table({
      restaurantId,
      tableNumber,
      capacity,
      area,
    });

    await newTable.save();

    return res.status(201).json({
      success: true,
      message: "Table added successfully.",
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
 * @description Retrieves all tables for the owner's restaurant.
 * @route GET /api/tables
 * @access Private (Restaurant Owner)
 */
export const getTables = async (req, res, next) => {
    try {
        const restaurantId = req.restaurant._id;
        const tables = await Table.find({ restaurantId }).sort({ tableNumber: 1 });

        return res.status(200).json({
            success: true,
            count: tables.length,
            data: tables,
        });
    } catch (error) {
        logger.error("Error fetching tables", { error: error.message, restaurantId: req.restaurant?._id });
        next(error);
    }
};

/**
 * @description Retrieves a single table by its ID.
 * @route GET /api/tables/:tableId
 * @access Private (Restaurant Owner)
 */
export const getTableById = async (req, res, next) => {
    try {
        const { tableId } = req.params;
        const restaurantId = req.restaurant._id;

        if (!mongoose.Types.ObjectId.isValid(tableId)) {
            return res.status(400).json({ success: false, message: "Invalid table ID format." });
        }

        const table = await Table.findOne({ _id: tableId, restaurantId });

        if (!table) {
            return res.status(404).json({ success: false, message: "Table not found or you do not have permission to view it." });
        }

        return res.status(200).json({ success: true, data: table });
    } catch (error) {
        logger.error("Error fetching table by ID", { error: error.message, tableId });
        next(error);
    }
};


/**
 * @description Updates a dining table's information.
 * @route PUT /api/tables/:tableId
 * @access Private (Restaurant Owner)
 */
export const updateTable = async (req, res, next) => {
  try {
    const { tableId } = req.params;
    const restaurantId = req.restaurant._id;
    const { tableNumber, capacity, area } = req.body;

    if (!mongoose.Types.ObjectId.isValid(tableId)) {
      return res.status(400).json({ success: false, message: "Invalid table ID format." });
    }

    const table = await Table.findOne({ _id: tableId, restaurantId });
    if (!table) {
      return res.status(404).json({ success: false, message: "Table not found or you do not have permission to edit it." });
    }

    // Check for uniqueness if table number is being changed
    if (tableNumber && tableNumber !== table.tableNumber) {
      const existingTable = await Table.findOne({ restaurantId, tableNumber, _id: { $ne: tableId } });
      if (existingTable) {
        return res.status(409).json({ success: false, message: `Another table with number '${tableNumber}' already exists.` });
      }
      table.tableNumber = tableNumber;
    }

    if (capacity) table.capacity = capacity;
    if (area) table.area = area;

    const updatedTable = await table.save();

    return res.status(200).json({
      success: true,
      message: "Table updated successfully.",
      data: updatedTable,
    });
  } catch (error) {
    if (error.name === 'ValidationError') {
        return res.status(400).json({ success: false, message: error.message });
    }
    logger.error("Error updating table", { error: error.message, tableId: req.params.tableId });
    next(error);
  }
};

/**
 * @description Toggles the active status of a table.
 * @route PATCH /api/tables/:tableId/toggle-active
 * @access Private (Restaurant Owner)
 */
export const toggleTableStatus = async (req, res, next) => {
    try {
        const { tableId } = req.params;
        const restaurantId = req.restaurant._id;

        if (!mongoose.Types.ObjectId.isValid(tableId)) {
            return res.status(400).json({ success: false, message: "Invalid table ID format." });
        }

        const table = await Table.findOne({ _id: tableId, restaurantId });
        if (!table) {
            return res.status(404).json({ success: false, message: "Table not found or you do not have permission to modify it." });
        }

        table.isActive = !table.isActive;
        await table.save();

        return res.status(200).json({
            success: true,
            message: `Table status updated to ${table.isActive ? 'active' : 'inactive'}.`,
            data: table,
        });

    } catch (error) {
        logger.error("Error toggling table status", { error: error.message, tableId });
        next(error);
    }
};


/**
 * @description Deletes a dining table.
 * @route DELETE /api/tables/:tableId
 * @access Private (Restaurant Owner)
 */
export const deleteTable = async (req, res, next) => {
  try {
    const { tableId } = req.params;
    const restaurantId = req.restaurant._id;

    if (!mongoose.Types.ObjectId.isValid(tableId)) {
      return res.status(400).json({ success: false, message: "Invalid table ID format." });
    }
    
    // In future, we must check if there are active bookings for this table before deleting.
    // For now, simple deletion is sufficient for FEATURE-001.

    const result = await Table.deleteOne({ _id: tableId, restaurantId });

    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, message: "Table not found or you do not have permission to delete it." });
    }

    return res.status(200).json({ success: true, message: "Table deleted successfully." });
  } catch (error) {
    logger.error("Error deleting table", { error: error.message, tableId: req.params.tableId });
    next(error);
  }
};