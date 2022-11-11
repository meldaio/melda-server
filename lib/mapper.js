
const {get, reduce, filter, matchesProperty, groupBy} = require("lodash");

/**
 * Mapper Class
 *
 * Maps system/data objects to response objects
 *
 */
class Mapper {

    /**
     *
     * @param data
     * @returns {{id: *}}
     */
    static project(data) {
        data = get(data, "_doc", data);

        data.rating = reduce(data.rating, (sum, vote) => {
          return sum + vote.rating;
        }, 0) / data.rating.length;

        return {
            "id": get(data, "_id"),
            "name": get(data, "name"),
            "title": get(data, "title"),
            "description": get(data, "description", "no-description-found"),
            "forkedFrom": get(data, "forkedFrom", null),
            "created": get(data, "created"),
            "owner": get(data, "owner"),
            "stages": get(data, "stages"),
            "rating": get(data, "rating"),
            "stats": {
                "views": get(data, "view", 1),
                "stages": 1,
                "forks": get(data, "forkCount", 0),
                "votes": 1
            }
        };
    }

    /**
     *
     * @param data
     * @returns {{id: *}}
     */
    static user(data) {
        data = get(data, "_doc", data);
        //
        return {
            "name": get(data, "name"),
            "username": get(data, "username"),
            "url": `/#/user/profile/${get(data, "slug")}`,
            // "email": get(data, "email"),
            // "provider": get(data, "provider"),
            "description": get(data, "description"),
            "socialAccounts": get(  data, "socialAccounts"),
            "interest": get(data, "interest")
        };
    }



    /**
     *
     * @param data
     * @returns {{id: *}}
     */
    static stage(data) {
        data = get(data, "_doc", data);
        //
        return {
            "title": get(data, "title"),
            "name": get(data, "name"),
            "created": get(data, "created"),
            "lastSuccessfulRun": get(data, "lastSuccessfulRun", null),
            "packages": Mapper._formatPackages(get(data, "packages", []))
        };
    }



    /**
     *
     * @param data
     * @returns {{id: *}}
     */
    static stageWithCells(data) {
        data = get(data, "_doc", data);
        //
        return {
            "title": get(data, "title"),
            "name": get(data, "name"),
            "created": get(data, "created"),
            "lastSuccessfulRun": get(data, "lastSuccessfulRun", null),
            "packages": Mapper._formatPackages(get(data, "packages", [])),
            "cells": get(data, "cells")
        };
    }


    /**
     *
     * @param data
     * @returns {{id: *}}
     */
    static cell(data) {
        data = get(data, "_doc", data);
        //
        return {
            "lang": get(data, "language"),
            "code": get(data, "code"),
            "output": get(data, "output"),
        };
    }


    // ------------------ private methods ----------------- //

    static _formatPackages(list) {
        let result = {},
            groups = Object.keys(groupBy(list, "language"));
        //
        groups.forEach(lang => {
           result[lang] = filter(list, matchesProperty("language", lang)).map(item => item._doc.name);
        });

        return result;
    }

}


module.exports = Mapper;