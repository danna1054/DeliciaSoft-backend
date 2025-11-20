const express = require('express');
const router = express.Router();
const controller = require('../controllers/sede.controller');
const multer = require('multer');

// Configuración de Multer para sedes
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB máximo
  },
  fileFilter: (req, file, cb) => {
    console.log('🔍 Validando archivo en sede.routes:', {
      fieldname: file.fieldname,
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: `${(file.size / 1024).toFixed(2)}KB`
    });
    
    const tiposPermitidos = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    
    if (tiposPermitidos.includes(file.mimetype)) {
      console.log('✅ Archivo válido');
      cb(null, true);
    } else {
      console.error('❌ Tipo de archivo no permitido:', file.mimetype);
      cb(new Error(`Tipo de archivo no permitido: ${file.mimetype}. Solo se aceptan: JPG, PNG, GIF, WebP`), false);
    }
  }
});

// Middleware para logging de peticiones
const logRequest = (req, res, next) => {
  console.log('═══════════════════════════════════════');
  console.log(`📍 ${req.method} ${req.path}`);
  console.log('⏰ Timestamp:', new Date().toISOString());
  console.log('📦 Body keys:', Object.keys(req.body));
  console.log('📦 Body values:', req.body);
  console.log('📎 File:', req.file ? `Sí - ${req.file.originalname}` : 'No');
  console.log('🌐 Content-Type:', req.headers['content-type']);
  console.log('═══════════════════════════════════════');
  next();
};

// Rutas CRUD
router.get('/', controller.getAll);
router.get('/:id', controller.getById);

// Crear y actualizar con posible imagen
// El campo 'imagen' debe coincidir con el nombre usado en FormData del frontend
router.post('/', logRequest, upload.single('imagen'), controller.create);
router.put('/:id', logRequest, upload.single('imagen'), controller.update);

router.delete('/:id', controller.remove);

// Middleware de manejo de errores de multer
router.use((error, req, res, next) => {
  console.error('═══════════════════════════════════════');
  console.error('❌ ERROR EN MIDDLEWARE DE SEDES');
  console.error('Tipo de error:', error.constructor.name);
  console.error('Mensaje:', error.message);
  console.error('═══════════════════════════════════════');
  
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        message: 'El archivo es demasiado grande. Tamaño máximo: 5MB',
        error: 'LIMIT_FILE_SIZE',
        codigo: error.code
      });
    }
    
    if (error.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({
        message: 'Campo de archivo inesperado. Usa el campo "imagen" en FormData',
        error: 'LIMIT_UNEXPECTED_FILE',
        codigo: error.code
      });
    }
    
    return res.status(400).json({
      message: 'Error al procesar el archivo',
      error: error.message,
      codigo: error.code
    });
  }
  
  if (error.message.includes('Tipo de archivo no permitido')) {
    return res.status(400).json({
      message: error.message,
      error: 'INVALID_FILE_TYPE',
      tiposPermitidos: ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp']
    });
  }
  
  // Error genérico
  res.status(500).json({
    message: 'Error en el procesamiento de la solicitud',
    error: error.message,
    tipo: error.constructor.name
  });
});

module.exports = router;