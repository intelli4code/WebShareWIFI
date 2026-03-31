# Use Node.js 18
FROM node:18-alpine

WORKDIR /app

# Copy package files and install dependencies
# We install all dependencies because some might be needed for the server
COPY package*.json ./
RUN npm install --production

# Copy server execution files
COPY server.js ./
COPY scripts ./scripts

# Set environment
ENV PORT=5174
ENV NODE_ENV=production

# Expose the port (Railway provides PORT env var)
EXPOSE 5174

# Start the application
CMD ["npm", "start"]
