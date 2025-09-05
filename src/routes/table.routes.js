import express from 'express';
import { validateRestaurant } from '../middleware/validateRestaurant.js';
import {
    addTable,
    getTables,
    getTableById,
    updateTable,
    toggleTableStatus,
    deleteTable
} from '../controllers/tableController.js';

const router = express.Router();

// All routes in this file are protected and require a restaurant owner to be authenticated.
router.use(validateRestaurant);

router.route('/')
    .post(addTable)
    .get(getTables);

router.route('/:tableId')
    .get(getTableById)
    .put(updateTable)
    .delete(deleteTable);

router.patch('/:tableId/toggle-active', toggleTableStatus);

export default router;