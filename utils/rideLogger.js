const buildSummary = (data = {}) => {
  const parts = [];

  if (data.rideId) parts.push(`ride=${data.rideId}`);
  if (data.driverId) parts.push(`driver=${data.driverId}`);
  if (data.customerId) parts.push(`customer=${data.customerId}`);
  if (data.userId) parts.push(`user=${data.userId}`);
  if (data.userType) parts.push(`userType=${data.userType}`);
  if (data.status) parts.push(`status=${data.status}`);
  if (data.message) parts.push(data.message);

  return parts.length ? ` | ${parts.join(' | ')}` : '';
};

export const logRideFlow = (event, data = {}) => {
  const summary = buildSummary(data);
  console.info(`[ride-flow] ${event}${summary}`);
};

export const logSocketFlow = (event, data = {}) => {
  const summary = buildSummary(data);
  console.info(`[socket] ${event}${summary}`);
};
