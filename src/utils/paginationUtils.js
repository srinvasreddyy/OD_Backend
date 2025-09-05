/**
 * Parses and validates pagination parameters from a request query.
 * @param {object} query - The request query object (e.g., req.query).
 * @returns {{page: number, limit: number, skip: number}} An object containing the sanitized page, limit, and calculated skip value.
 */
export const getPaginationParams = (query) => {
    let page = parseInt(query.page, 10);
    let limit = parseInt(query.limit, 10);

    // Default to page 1 if page is not a number or is less than 1
    if (isNaN(page) || page < 1) {
        page = 1;
    }

    // Default to a limit of 10 if limit is not a number or is less than 1
    if (isNaN(limit) || limit < 1) {
        limit = 10;
    }

    const skip = (page - 1) * limit;

    return { page, limit, skip };
};