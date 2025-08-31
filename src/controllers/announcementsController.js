import mongoose from "mongoose";
import Announcement from "../models/Announcements.js";
import uploadOnCloudinary from "../config/cloudinary.js";
import { v2 as cloudinary } from "cloudinary";

// A custom error class for creating predictable, handled errors.
class ApiError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

const getPublicIdFromUrl = (url) => {
  if (!url) return null;
  const parts = url.split("/");
  const publicIdWithExtension = parts.slice(-2).join("/");
  return publicIdWithExtension.split(".").slice(0, -1).join(".");
};


/**
 * @description Creates a new announcement for a restaurant.
 * @route POST /api/announcements
 * @access Private (Restaurant Owner)
 */
export const createAnnouncement = async (req, res) => {
  const restaurantId = req.restaurant._id;
  const { title, content, announcementType } = req.body;

  try {
    if (!title || !content || !announcementType) {
      throw new ApiError(400, "Title, content, and announcement type are required.");
    }
    if (!['text', 'image'].includes(announcementType)) {
      throw new ApiError(400, "Invalid announcement type. Must be 'text' or 'image'.");
    }

    let imageUrl = null;
    if (announcementType === "image") {
      if (!req.file) {
        throw new ApiError(400, "An image file is required for an image announcement.");
      }
      const result = await uploadOnCloudinary(req.file);
      imageUrl = result.secure_url;
    }

    const newAnnouncement = new Announcement({
      restaurantId,
      title,
      content,
      announcementType,
      imageUrl,
    });

    await newAnnouncement.save();
    return res.status(201).json({
      success: true,
      message: "Announcement created successfully.",
      data: newAnnouncement
    });

  } catch (error) {
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({
      success: false,
      message: error.message || "An unexpected server error occurred while creating the announcement."
    });
  }
};

/**
 * @description Edits an existing announcement.
 * @route PUT /api/announcements/:announcementId
 * @access Private (Restaurant Owner)
 */
export const editAnnouncement = async (req, res) => {
  const restaurantId = req.restaurant._id;
  const { announcementId } = req.params;
  const { title, content } = req.body;

  try {
    if (!mongoose.Types.ObjectId.isValid(announcementId)) {
      throw new ApiError(400, "The provided announcement ID is not valid.");
    }

    const announcement = await Announcement.findById(announcementId);

    if (!announcement) {
      throw new ApiError(404, "Announcement not found with the given ID.");
    }

    if (announcement.restaurantId.toString() !== restaurantId.toString()) {
      throw new ApiError(403, "Forbidden: You do not have permission to edit this announcement.");
    }

    if (title) announcement.title = title;
    if (content) announcement.content = content;

    await announcement.save();
    return res.status(200).json({
      success: true,
      message: "Announcement updated successfully.",
      data: announcement
    });

  } catch (error) {
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({
      success: false,
      message: error.message || "An unexpected server error occurred while editing the announcement."
    });
  }
};

/**
 * @description Adds, updates, or removes a reaction from an announcement using atomic operations.
 * @route POST /api/announcements/:announcementId/react
 * @access Private (User)
 */
export const reactToAnnouncement = async (req, res) => {
  const userId = req.user._id;
  const { announcementId } = req.params;
  const { reaction } = req.body;

  try {
    if (!mongoose.Types.ObjectId.isValid(announcementId)) {
      throw new ApiError(400, "The provided announcement ID is not valid.");
    }

    const allowedReactions = ["👍", "❤️", "😂", "😢", "😡"];
    if (!reaction || !allowedReactions.includes(reaction)) {
      throw new ApiError(400, `Invalid reaction. Please provide one of the following: ${allowedReactions.join(", ")}`);
    }

    const announcement = await Announcement.findById(announcementId);
    if (!announcement || !announcement.isActive) {
      throw new ApiError(404, "Announcement not found or is not active.");
    }
    
    const existingReaction = announcement.reactions.find(r => r.userId.toString() === userId.toString());

    if (existingReaction) {
        if (existingReaction.reaction === reaction) {
            // Same reaction clicked again: remove it
            await Announcement.updateOne(
                { _id: announcementId },
                { $pull: { reactions: { userId } } }
            );
        } else {
            // Different reaction: update it
            await Announcement.updateOne(
                { _id: announcementId, "reactions.userId": userId },
                { $set: { "reactions.$.reaction": reaction, "reactions.$.createdAt": new Date() } }
            );
        }
    } else {
        // New reaction
        await Announcement.updateOne(
            { _id: announcementId },
            { $addToSet: { reactions: { userId, reaction, createdAt: new Date() } } }
        );
    }

    // Atomically recalculate count from array size to ensure consistency
    const finalAnnouncement = await Announcement.findByIdAndUpdate(
      announcementId,
      [{ $set: { reactionCount: { $size: "$reactions" } } }],
      { new: true }
    );

    return res.status(200).json({
      success: true,
      message: "Reaction updated successfully.",
      data: finalAnnouncement
    });

  } catch (error) {
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({
      success: false,
      message: error.message || "An unexpected server error occurred while reacting to the announcement."
    });
  }
};

/**
 * @description Get all active announcements for a restaurant with pagination.
 * @route GET /api/announcements/restaurant/:restaurantId
 * @access Public
 */
export const getAnnouncements = async (req, res) => {
  const { restaurantId } = req.params;
  const { page = 1, limit = 10 } = req.query;

  try {
    if (!mongoose.Types.ObjectId.isValid(restaurantId)) {
      throw new ApiError(400, "The provided restaurant ID is not valid.");
    }

    const announcements = await Announcement.find({ restaurantId, isActive: true })
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .exec();

    const count = await Announcement.countDocuments({ restaurantId, isActive: true });

    return res.status(200).json({
      success: true,
      data: announcements,
      totalPages: Math.ceil(count / limit),
      currentPage: parseInt(page)
    });

  } catch (error) {
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({
      success: false,
      message: error.message || "An unexpected server error occurred while fetching announcements."
    });
  }
};

/**
 * @description Get all announcements (active and inactive) for the logged-in restaurant owner.
 * @route GET /api/announcements/owner/all
 * @access Private (Restaurant Owner)
 */
export const getOwnerAnnouncements = async (req, res) => {
    const restaurantId = req.restaurant._id;
    const { page = 1, limit = 10 } = req.query;

    try {
        const announcements = await Announcement.find({ restaurantId })
            .sort({ createdAt: -1 })
            .limit(limit * 1)
            .skip((page - 1) * limit)
            .exec();

        const count = await Announcement.countDocuments({ restaurantId });

        return res.status(200).json({
            success: true,
            data: announcements,
            totalPages: Math.ceil(count / limit),
            currentPage: parseInt(page)
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            message: "An unexpected server error occurred while fetching your announcements."
        });
    }
};

/**
 * @description Get a single announcement by its ID.
 * @route GET /api/announcements/:announcementId
 * @access Public
 */
export const getSingleAnnouncement = async (req, res) => {
    const { announcementId } = req.params;

    try {
        if (!mongoose.Types.ObjectId.isValid(announcementId)) {
            throw new ApiError(400, "The provided announcement ID is not valid.");
        }

        const announcement = await Announcement.findOne({ _id: announcementId, isActive: true })
            .populate('restaurantId', 'restaurantName address');

        if (!announcement) {
            throw new ApiError(404, "Announcement not found or is not currently active.");
        }

        return res.status(200).json({
            success: true,
            data: announcement
        });

    } catch (error) {
        const statusCode = error.statusCode || 500;
        return res.status(statusCode).json({
            success: false,
            message: error.message || "An unexpected server error occurred."
        });
    }
};

/**
 * @description Get all active announcements from all restaurants with pagination.
 * @route GET /api/announcements/all
 * @access Public
 */
export const getAllActiveAnnouncements = async (req, res) => {
    const { page = 1, limit = 10 } = req.query;

    try {
        const announcements = await Announcement.find({ isActive: true })
            .populate('restaurantId', 'restaurantName address.city')
            .sort({ createdAt: -1 })
            .limit(limit * 1)
            .skip((page - 1) * limit)
            .exec();

        const count = await Announcement.countDocuments({ isActive: true });

        return res.status(200).json({
            success: true,
            data: announcements,
            totalPages: Math.ceil(count / limit),
            currentPage: parseInt(page)
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            message: "An unexpected server error occurred while fetching announcements."
        });
    }
};

/**
 * @description Toggles the active status of an announcement.
 * @route PATCH /api/announcements/:announcementId/toggle-active
 * @access Private (Restaurant Owner)
 */
export const toggleAnnouncementStatus = async (req, res) => {
    const restaurantId = req.restaurant._id;
    const { announcementId } = req.params;

    try {
        if (!mongoose.Types.ObjectId.isValid(announcementId)) {
            throw new ApiError(400, "The provided announcement ID is not valid.");
        }

        const announcement = await Announcement.findOne({ _id: announcementId, restaurantId });

        if (!announcement) {
            throw new ApiError(404, "Announcement not found or you do not have permission to modify it.");
        }

        announcement.isActive = !announcement.isActive;
        await announcement.save();

        return res.status(200).json({
            success: true,
            message: `Announcement has been ${announcement.isActive ? 'activated' : 'deactivated'}.`,
            data: announcement
        });

    } catch (error) {
        const statusCode = error.statusCode || 500;
        return res.status(statusCode).json({
            success: false,
            message: error.message || "An unexpected server error occurred."
        });
    }
};

/**
 * @description Deletes an announcement and its associated image from Cloudinary.
 * @route DELETE /api/announcements/:announcementId
 * @access Private (Restaurant Owner)
 */
export const deleteAnnouncement = async (req, res) => {
    const restaurantId = req.restaurant._id;
    const { announcementId } = req.params;

    try {
        if (!mongoose.Types.ObjectId.isValid(announcementId)) {
            throw new ApiError(400, "The provided announcement ID is not valid.");
        }

        const announcement = await Announcement.findOne({ _id: announcementId, restaurantId });

        if (!announcement) {
            throw new ApiError(404, "Announcement not found or you do not have permission to delete it.");
        }

        if (announcement.imageUrl) {
            const publicId = getPublicIdFromUrl(announcement.imageUrl);
            if(publicId) await cloudinary.uploader.destroy(publicId);
        }

        await announcement.deleteOne();

        return res.status(200).json({
            success: true,
            message: "Announcement deleted successfully."
        });

    } catch (error) {
        const statusCode = error.statusCode || 500;
        return res.status(statusCode).json({
            success: false,
            message: error.message || "An unexpected server error occurred while deleting the announcement."
        });
    }
};

/**
 * @description Get statistics for announcements of a restaurant.
 * @route GET /api/announcements/stats
 * @access Private (Restaurant Owner)
 */
export const getAnnouncementStats = async (req, res) => {
    const restaurantId = req.restaurant._id;

    try {
        const now = new Date();
        const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

        const oldestAnnouncement = await Announcement.findOne({ restaurantId }).sort({ createdAt: 1 }).lean();

        if (!oldestAnnouncement) {
             return res.status(200).json({
                success: true,
                data: {
                    totalReactions: 0,
                    reactionsInLast24h: 0,
                    percentageChangeInLast24h: 0,
                    message: "No announcements found to generate stats."
                }
            });
        }

        if (oldestAnnouncement.createdAt > twentyFourHoursAgo) {
            const stats = await Announcement.aggregate([
                { $match: { restaurantId: new mongoose.Types.ObjectId(restaurantId) } },
                { $group: { _id: null, total: { $sum: "$reactionCount" } } }
            ]);
            
            return res.status(200).json({
                success: true,
                data: {
                    totalReactions: stats[0]?.total || 0,
                    reactionsInLast24h: stats[0]?.total || 0,
                    percentageChangeInLast24h: null,
                    message: "Your announcements are new. Check back in 24 hours for reaction trends."
                }
            });
        }

        const fortyEightHoursAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);
        const stats = await Announcement.aggregate([
            { $match: { restaurantId: new mongoose.Types.ObjectId(restaurantId) } },
            { $unwind: "$reactions" },
            {
                $facet: {
                    "reactionsLast24h": [
                        { $match: { "reactions.createdAt": { $gte: twentyFourHoursAgo } } },
                        { $count: "count" }
                    ],
                    "reactions24hTo48h": [
                        { $match: { "reactions.createdAt": { $gte: fortyEightHoursAgo, $lt: twentyFourHoursAgo } } },
                        { $count: "count" }
                    ]
                }
            }
        ]);

        const totalReactionsResult = await Announcement.aggregate([
                { $match: { restaurantId: new mongoose.Types.ObjectId(restaurantId) } },
                { $group: { _id: null, total: { $sum: "$reactionCount" } } }
            ]);
        const totalReactions = totalReactionsResult[0]?.total || 0;
        const reactionsLast24h = stats[0].reactionsLast24h[0]?.count || 0;
        const reactions24hTo48h = stats[0].reactions24hTo48h[0]?.count || 0;

        let percentageChange = 0;
        if (reactions24hTo48h > 0) {
            percentageChange = ((reactionsLast24h - reactions24hTo48h) / reactions24hTo48h) * 100;
        } else if (reactionsLast24h > 0) {
            percentageChange = 100;
        }

        return res.status(200).json({
            success: true,
            data: {
                totalReactions,
                reactionsInLast24h: reactionsLast24h,
                percentageChangeInLast24h: parseFloat(percentageChange.toFixed(2))
            }
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            message: error.message || "An unexpected server error occurred while fetching announcement stats."
        });
    }
};