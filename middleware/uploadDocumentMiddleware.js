import multer from 'multer';

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const allowedTypes = ['application/json', 'text/csv', 'text/plain'];
  const allowedExtensions = ['.json', '.csv'];
  
  const isAllowedType = allowedTypes.includes(file.mimetype);
  const isAllowedExt = allowedExtensions.some(ext => file.originalname.toLowerCase().endsWith(ext));
  
  if (isAllowedType || isAllowedExt) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only JSON and CSV files are allowed.'), false);
  }
};

export const uploadDocument = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

export const handleDocumentMulterError = (error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        message: 'File too large. Maximum size is 10MB.'
      });
    }
    return res.status(400).json({
      success: false,
      message: error.message
    });
  }
  
  if (error) {
    return res.status(400).json({
      success: false,
      message: error.message
    });
  }
  
  next();
};

export default uploadDocument;