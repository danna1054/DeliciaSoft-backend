const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// --- Dependencias para Cloudinary ---
const { v2: cloudinary } = require('cloudinary');
const streamifier = require('streamifier');

// 🔧 CORRECCIÓN CRÍTICA: Usar las mismas variables que imagenes.controller.js
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Helper para subir buffer a Cloudinary
async function subirACloudinary(buffer, folder = 'deliciasoft/sedes') {
  return new Promise((resolve, reject) => {
    console.log('📤 Subiendo imagen a Cloudinary...');
    console.log('📂 Folder:', folder);
    console.log('🔑 Cloud name:', cloudinary.config().cloud_name);
    
    // Verificar configuración antes de subir
    const config = cloudinary.config();
    if (!config.cloud_name || !config.api_key || !config.api_secret) {
      console.error('❌ Cloudinary no configurado correctamente:', {
        cloud_name: !!config.cloud_name,
        api_key: !!config.api_key,
        api_secret: !!config.api_secret
      });
      return reject(new Error('Configuración de Cloudinary incompleta'));
    }

    const uploadStream = cloudinary.uploader.upload_stream(
      { 
        folder,
        transformation: [
          { 
            width: 800, 
            height: 600, 
            crop: 'limit',
            quality: 'auto:good'
          }
        ]
      },
      (error, result) => {
        if (error) {
          console.error('❌ Error de Cloudinary:', error);
          reject(error);
        } else {
          console.log('✅ Imagen subida exitosamente:', result.secure_url);
          resolve(result);
        }
      }
    );
    
    streamifier.createReadStream(buffer).pipe(uploadStream);
  });
}

// Obtener todas las sedes
exports.getAll = async (req, res) => {
  try {
    console.log('📋 Obteniendo todas las sedes...');
    
    const sedes = await prisma.sede.findMany({
      orderBy: { idsede: 'desc' }
    });

    console.log(`✅ Se encontraron ${sedes.length} sedes`);
    res.json(sedes);
  } catch (error) {
    console.error('❌ Error al obtener sedes:', error);
    res.status(500).json({ 
      message: 'Error al obtener sedes', 
      error: error.message 
    });
  }
};

// Obtener sede por id
exports.getById = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    
    if (isNaN(id)) {
      return res.status(400).json({ 
        message: 'ID inválido. Debe ser un número.' 
      });
    }

    console.log(`🔍 Buscando sede con ID: ${id}`);

    const sede = await prisma.sede.findUnique({
      where: { idsede: id }
    });
    
    if (!sede) {
      return res.status(404).json({ 
        message: `Sede no encontrada con ID: ${id}` 
      });
    }

    console.log(`✅ Sede encontrada: ${sede.nombre}`);
    res.json(sede);
  } catch (error) {
    console.error('❌ Error al obtener sede:', error);
    res.status(500).json({ 
      message: 'Error al obtener sede', 
      error: error.message 
    });
  }
};

// Crear sede
exports.create = async (req, res) => {
  try {
    console.log('🔍 === DEBUG CREAR SEDE ===');
    console.log('📦 req.body:', req.body);
    console.log('📎 req.file:', req.file ? {
      fieldname: req.file.fieldname,
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size
    } : 'No hay archivo');
    console.log('📋 Content-Type:', req.headers['content-type']);

    const { nombre, telefono, direccion, estado } = req.body;

    // 🔧 VALIDACIÓN: Verificar campos requeridos
    if (!nombre || !telefono || !direccion) {
      console.error('❌ Faltan campos requeridos:', {
        nombre: !!nombre,
        telefono: !!telefono,
        direccion: !!direccion
      });
      
      return res.status(400).json({ 
        message: 'Faltan campos requeridos: nombre, telefono y direccion son obligatorios',
        camposRecibidos: {
          nombre: nombre || null,
          telefono: telefono || null,
          direccion: direccion || null,
          estado: estado || null
        }
      });
    }

    // Validar formato de teléfono colombiano
    const telefonoLimpio = telefono.replace(/\s/g, '');
    const telefonoRegex = /^3[0-9]{9}$/;
    
    if (!telefonoRegex.test(telefonoLimpio)) {
      return res.status(400).json({
        message: 'Teléfono inválido. Debe ser un número colombiano de 10 dígitos comenzando con 3',
        ejemplo: '3001234567'
      });
    }

    // Validar longitud de campos
    if (nombre.trim().length < 2 || nombre.trim().length > 20) {
      return res.status(400).json({
        message: 'El nombre debe tener entre 2 y 20 caracteres'
      });
    }

    if (direccion.trim().length < 5 || direccion.trim().length > 20) {
      return res.status(400).json({
        message: 'La dirección debe tener entre 5 y 20 caracteres'
      });
    }

    console.log('✅ Campos validados correctamente');

    // Subir imagen si existe
    let imagenUrl = null;
    if (req.file) {
      try {
        console.log('📤 Procesando imagen...');
        const result = await subirACloudinary(req.file.buffer);
        imagenUrl = result.secure_url;
        console.log('✅ Imagen subida:', imagenUrl);
      } catch (imageError) {
        console.error('❌ Error al subir imagen:', imageError);
        // Continuar sin imagen en caso de error
        console.warn('⚠️ Continuando sin imagen');
      }
    }

    // Crear sede en la base de datos
    const datosParaCrear = {
      nombre: nombre.trim(),
      telefono: telefonoLimpio,
      direccion: direccion.trim(),
      estado: estado === 'true' || estado === true || estado === 1,
      imagenUrl: imagenUrl || null
    };

    console.log('💾 Datos para crear en BD:', datosParaCrear);

    const nuevaSede = await prisma.sede.create({
      data: datosParaCrear
    });

    console.log('✅ Sede creada exitosamente:', {
      id: nuevaSede.idsede,
      nombre: nuevaSede.nombre
    });

    res.status(201).json(nuevaSede);
  } catch (error) {
    console.error('❌ ERROR EN CREATE:', error);
    console.error('Stack:', error.stack);
    
    // Error de Prisma por duplicado
    if (error.code === 'P2002') {
      return res.status(400).json({
        message: 'Ya existe una sede con estos datos',
        error: 'Datos duplicados'
      });
    }
    
    // Error de validación de Prisma
    if (error.code === 'P2000') {
      return res.status(400).json({
        message: 'Los datos proporcionados exceden el límite permitido',
        error: error.message
      });
    }
    
    res.status(500).json({ 
      message: 'Error al crear sede', 
      error: error.message,
      code: error.code,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

// Actualizar sede
exports.update = async (req, res) => {
  try {
    console.log('🔍 === DEBUG ACTUALIZAR SEDE ===');
    console.log('📦 ID:', req.params.id);
    console.log('📦 req.body:', req.body);
    console.log('📎 req.file:', req.file ? 'Sí hay archivo' : 'No hay archivo');
    
    const id = parseInt(req.params.id);
    
    if (isNaN(id)) {
      return res.status(400).json({ 
        message: 'ID inválido. Debe ser un número.' 
      });
    }

    const { nombre, telefono, direccion, estado } = req.body;

    // Verificar que la sede existe
    const sedeExiste = await prisma.sede.findUnique({ 
      where: { idsede: id } 
    });
    
    if (!sedeExiste) {
      return res.status(404).json({ 
        message: `Sede no encontrada con ID: ${id}` 
      });
    }

    // Validar campos requeridos
    if (!nombre || !telefono || !direccion) {
      return res.status(400).json({ 
        message: 'Faltan campos requeridos: nombre, telefono y direccion son obligatorios'
      });
    }

    // Validar formato de teléfono
    const telefonoLimpio = telefono.replace(/\s/g, '');
    const telefonoRegex = /^3[0-9]{9}$/;
    
    if (!telefonoRegex.test(telefonoLimpio)) {
      return res.status(400).json({
        message: 'Teléfono inválido. Debe ser un número colombiano de 10 dígitos comenzando con 3'
      });
    }

    // Validar longitud de campos
    if (nombre.trim().length < 2 || nombre.trim().length > 20) {
      return res.status(400).json({
        message: 'El nombre debe tener entre 2 y 20 caracteres'
      });
    }

    if (direccion.trim().length < 5 || direccion.trim().length > 20) {
      return res.status(400).json({
        message: 'La dirección debe tener entre 5 y 20 caracteres'
      });
    }

    // Mantener URL anterior o subir nueva imagen
    let imagenUrl = sedeExiste.imagenUrl;
    if (req.file) {
      try {
        console.log('📤 Subiendo nueva imagen...');
        const result = await subirACloudinary(req.file.buffer);
        imagenUrl = result.secure_url;
        console.log('✅ Nueva imagen subida:', imagenUrl);
      } catch (imageError) {
        console.error('❌ Error al subir imagen:', imageError);
        console.warn('⚠️ Manteniendo imagen anterior');
      }
    }

    const datosActualizados = {
      nombre: nombre.trim(),
      telefono: telefonoLimpio,
      direccion: direccion.trim(),
      estado: estado === 'true' || estado === true || estado === 1,
      imagenUrl
    };

    console.log('💾 Datos para actualizar:', datosActualizados);

    const sedeActualizada = await prisma.sede.update({
      where: { idsede: id },
      data: datosActualizados
    });

    console.log('✅ Sede actualizada exitosamente:', sedeActualizada.nombre);
    res.json(sedeActualizada);
  } catch (error) {
    console.error('❌ ERROR EN UPDATE:', error);
    
    if (error.code === 'P2002') {
      return res.status(400).json({
        message: 'Ya existe una sede con estos datos',
        error: 'Datos duplicados'
      });
    }
    
    res.status(500).json({ 
      message: 'Error al actualizar sede', 
      error: error.message 
    });
  }
};

// Eliminar sede
exports.remove = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    
    if (isNaN(id)) {
      return res.status(400).json({ 
        message: 'ID inválido. Debe ser un número.' 
      });
    }

    console.log(`🗑️ Eliminando sede ID: ${id}`);

    const sedeExiste = await prisma.sede.findUnique({ 
      where: { idsede: id } 
    });
    
    if (!sedeExiste) {
      return res.status(404).json({ 
        message: `Sede no encontrada con ID: ${id}` 
      });
    }

    await prisma.sede.delete({ 
      where: { idsede: id } 
    });
    
    console.log(`✅ Sede ${id} eliminada correctamente`);
    res.json({ 
      message: 'Sede eliminada correctamente',
      sedeEliminada: {
        id: sedeExiste.idsede,
        nombre: sedeExiste.nombre
      }
    });
  } catch (error) {
    console.error('❌ Error al eliminar sede:', error);
    
    // Error de restricción de clave foránea
    if (error.code === 'P2003') {
      return res.status(400).json({
        message: 'No se puede eliminar la sede porque tiene registros asociados (inventarios o ventas)',
        error: 'Intenta desactivarla en lugar de eliminarla'
      });
    }
    
    res.status(500).json({ 
      message: 'Error al eliminar sede', 
      error: error.message 
    });
  }
};