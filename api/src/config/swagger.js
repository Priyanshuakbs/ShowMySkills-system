import dotenv from 'dotenv';
dotenv.config();

import swaggerJSDoc from 'swagger-jsdoc';

const options = {
  definition: {
    openapi: '3.0.0',

    info: {
      title: 'ShowMySkills API',
      version: '1.0.0',
      description: 'OpenSource Express REST API with Swagger documentation'
    },

    servers: [
      {
        url: 'http://localhost:5000',
        description: 'Local Development API Endpoint'
      },
      {
        url: 'https://showmyskills.xyphx.com',
        description: 'Production API Endpoint'
      }
    ],

    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT'
        }
      }
    }
  },

  apis: [
    './src/routes/*.js',
    './src/controllers/*.js'
  ]
};

export const swaggerSpec = swaggerJSDoc(options);