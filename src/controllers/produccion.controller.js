const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Obtener todas las producciones
exports.getAll = async (req, res) => {
  try {
    const producciones = await prisma.produccion.findMany({
      include: {
        detalleproduccion: {
          include: {
            productogeneral: {
              include: {
                imagenes: {
                  select: { urlimg: true }
                },
                receta: {
                  include: {
                    detallereceta: {
                      include: {
                        insumos: {
                          select: {
                            nombreinsumo: true,
                            idinsumo: true
                          }
                        },
                        unidadmedida: {
                          select: {
                            unidadmedida: true
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      },
      orderBy: {
        idproduccion: 'desc'
      }
    });

    // Transformar datos para el frontend
    const produccionesTransformadas = producciones.map(prod => ({
      ...prod,
      detalleproduccion: prod.detalleproduccion?.map(detalle => ({
        id: detalle.productogeneral?.idproductogeneral,
        nombre: detalle.productogeneral?.nombreproducto,
        cantidad: parseFloat(detalle.cantidadproducto || 0),
        imagen: detalle.productogeneral?.imagenes?.urlimg || null,
        receta: detalle.productogeneral?.receta ? {
          id: detalle.productogeneral.receta.idreceta,
          nombre: detalle.productogeneral.receta.nombrereceta,
          especificaciones: detalle.productogeneral.receta.especificaciones,
          imagen: detalle.productogeneral.imagenes?.urlimg || null,
          insumos: detalle.productogeneral.receta.detallereceta?.map(dr => ({
            id: dr.idinsumo,
            nombre: dr.insumos?.nombreinsumo || 'Sin nombre',
            cantidad: parseFloat(dr.cantidad || 0),
            unidad: dr.unidadmedida?.unidadmedida || 'unidad'
          })) || [],
          pasos: [] // Si tienes pasos, agrégalos aquí
        } : null,
        insumos: detalle.productogeneral?.receta?.detallereceta?.map(dr => ({
          id: dr.idinsumo,
          nombre: dr.insumos?.nombreinsumo || 'Sin nombre',
          cantidad: parseFloat(dr.cantidad || 0),
          unidad: dr.unidadmedida?.unidadmedida || 'unidad'
        })) || []
      })) || []
    }));

    res.json(produccionesTransformadas);
  } catch (error) {
    console.error('❌ Error al obtener producciones:', error);
    res.status(500).json({ 
      message: 'Error al obtener producciones', 
      error: error.message 
    });
  }
};


// Obtener producción por id
exports.getById = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const produccion = await prisma.produccion.findUnique({
      where: { idproduccion: id }
    });
    if (!produccion) return res.status(404).json({ message: 'Producción no encontrada' });
    res.json(produccion);
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener producción', error: error.message });
  }
};

// Generar número de pedido automático
async function generarNumeroPedido() {
  try {
    // Obtener el último pedido
    const ultimosPedidos = await prisma.produccion.findMany({
      where: {
        numeropedido: {
          not: null,
          not: ''
        }
      },
      orderBy: {
        idproduccion: 'desc'
      },
      take: 1
    });

    let nuevoNumero = 1;
    
    if (ultimosPedidos.length > 0 && ultimosPedidos[0].numeropedido) {
      // Extraer el número del formato P-001
      const match = ultimosPedidos[0].numeropedido.match(/P-(\d+)/);
      if (match) {
        nuevoNumero = parseInt(match[1]) + 1;
      }
    }

    return `P-${String(nuevoNumero).padStart(3, '0')}`;
  } catch (error) {
    console.error('Error al generar número de pedido:', error);
    return `P-${String(Date.now()).slice(-3)}`;
  }
}

// Crear producción
exports.create = async (req, res) => {
  try {
    console.log('📦 Datos recibidos en el backend:', req.body);
    
    const { 
      TipoProduccion, 
      nombreproduccion,
      fechapedido, 
      fechaentrega,
      productos // productos incluyen cantidadesPorSede
    } = req.body;

    if (!TipoProduccion || !nombreproduccion?.trim()) {
      return res.status(400).json({ message: 'Datos incompletos' });
    }

    let numeropedido = '';
    if (TipoProduccion.toLowerCase() === 'pedido') {
      numeropedido = await generarNumeroPedido();
    }

    const estadoproduccion = TipoProduccion.toLowerCase() === 'fabrica' ? 1 : 2;
    const estadopedido = TipoProduccion.toLowerCase() === 'pedido' ? 1 : null;

    const nuevaProduccion = await prisma.$transaction(async (tx) => {
      // 1. Crear la producción
      const produccion = await tx.produccion.create({
        data: {
          TipoProduccion,
          nombreproduccion: nombreproduccion.trim(),
          fechapedido: fechapedido ? new Date(fechapedido) : new Date(),
          fechaentrega: fechaentrega && TipoProduccion.toLowerCase() === 'pedido' 
            ? new Date(fechaentrega) 
            : null,
          numeropedido,
          estadoproduccion,
          estadopedido
        }
      });

      // 2. Crear detalles con sedes dinámicas
      if (productos && Array.isArray(productos) && productos.length > 0) {
        const detallesParaCrear = [];
        
        productos.forEach(prod => {
          if (TipoProduccion.toLowerCase() === 'fabrica' && prod.cantidadesPorSede) {
            // Crear un detalle por cada sede con cantidad
            Object.entries(prod.cantidadesPorSede).forEach(([nombreSede, cantidad]) => {
              if (cantidad && cantidad > 0) {
                detallesParaCrear.push({
                  idproduccion: produccion.idproduccion,
                  idproductogeneral: prod.id,
                  cantidadproducto: parseFloat(cantidad),
                  sede: nombreSede
                });
              }
            });
          } else {
            // Para pedido
            detallesParaCrear.push({
              idproduccion: produccion.idproduccion,
              idproductogeneral: prod.id,
              cantidadproducto: parseFloat(prod.cantidad || 1),
              sede: prod.sede || null
            });
          }
        });

        if (detallesParaCrear.length > 0) {
          await tx.detalleproduccion.createMany({
            data: detallesParaCrear
          });
        }
      }

      // 3. Retornar con todo incluido
      return await tx.produccion.findUnique({
        where: { idproduccion: produccion.idproduccion },
        include: {
          detalleproduccion: {
            include: {
              productogeneral: {
                include: {
                  imagenes: { select: { urlimg: true } },
                  receta: {
                    include: {
                      detallereceta: {
                        include: {
                          insumos: { select: { nombreinsumo: true, idinsumo: true } },
                          unidadmedida: { select: { unidadmedida: true } }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      });
    });

    console.log('✅ Producción creada:', nuevaProduccion);
    res.status(201).json(nuevaProduccion);

  } catch (error) {
    console.error('❌ Error al crear producción:', error);
    res.status(500).json({ 
      message: 'Error al crear producción', 
      error: error.message
    });
  }
};

exports.getAll = async (req, res) => {
  try {
    const producciones = await prisma.produccion.findMany({
      include: {
        detalleproduccion: {
          include: {
            productogeneral: {
              include: {
                imagenes: { select: { urlimg: true } },
                receta: {
                  include: {
                    detallereceta: {
                      include: {
                        insumos: { select: { nombreinsumo: true, idinsumo: true } },
                        unidadmedida: { select: { unidadmedida: true } }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      },
      orderBy: { idproduccion: 'desc' }
    });

    // Obtener todas las sedes para referencia
    const sedesDisponibles = await obtenerSedesActivas();

    const produccionesTransformadas = producciones.map(prod => {
      // Agrupar detalles por producto
      const productosMap = {};
      
      prod.detalleproduccion?.forEach(detalle => {
        const idProd = detalle.idproductogeneral;
        
        if (!productosMap[idProd]) {
          productosMap[idProd] = {
            id: idProd,
            nombre: detalle.productogeneral?.nombreproducto,
            imagen: detalle.productogeneral?.imagenes?.urlimg || null,
            cantidadTotal: 0,
            cantidadesPorSede: {}, // Objeto dinámico con todas las sedes
            receta: detalle.productogeneral?.receta ? {
              id: detalle.productogeneral.receta.idreceta,
              nombre: detalle.productogeneral.receta.nombrereceta,
              especificaciones: detalle.productogeneral.receta.especificaciones,
              insumos: detalle.productogeneral.receta.detallereceta?.map(dr => ({
                id: dr.idinsumo,
                nombre: dr.insumos?.nombreinsumo,
                cantidad: parseFloat(dr.cantidad || 0),
                unidad: dr.unidadmedida?.unidadmedida
              })) || []
            } : null,
            insumos: detalle.productogeneral?.receta?.detallereceta?.map(dr => ({
              id: dr.idinsumo,
              nombre: dr.insumos?.nombreinsumo,
              cantidad: parseFloat(dr.cantidad || 0),
              unidad: dr.unidadmedida?.unidadmedida
            })) || []
          };
        }
        
        const cantidad = parseFloat(detalle.cantidadproducto || 0);
        productosMap[idProd].cantidadTotal += cantidad;
        
        // Agregar cantidad a la sede específica
        if (detalle.sede) {
          if (!productosMap[idProd].cantidadesPorSede[detalle.sede]) {
            productosMap[idProd].cantidadesPorSede[detalle.sede] = 0;
          }
          productosMap[idProd].cantidadesPorSede[detalle.sede] += cantidad;
        }
      });

      return {
        ...prod,
        detalleproduccion: Object.values(productosMap),
        sedesDisponibles: sedesDisponibles.map(s => s.nombre)
      };
    });

    res.json(produccionesTransformadas);
  } catch (error) {
    console.error('❌ Error:', error);
    res.status(500).json({ message: 'Error al obtener producciones', error: error.message });
  }
};

// Eliminar producción
exports.remove = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const produccionExiste = await prisma.produccion.findUnique({ 
      where: { idproduccion: id } 
    });
    
    if (!produccionExiste) {
      return res.status(404).json({ message: 'Producción no encontrada' });
    }

    await prisma.produccion.delete({ where: { idproduccion: id } });
    res.json({ message: 'Producción eliminada correctamente' });
  } catch (error) {
    console.error('Error al eliminar producción:', error);
    res.status(500).json({ 
      message: 'Error al eliminar producción', 
      error: error.message 
    });
  }
};

async function obtenerSedesActivas() {
  try {
    const sedes = await prisma.sede.findMany({
      where: { estado: true },
      select: {
        idsede: true,
        nombre: true
      },
      orderBy: { nombre: 'asc' }
    });
    return sedes;
  } catch (error) {
    console.error('Error obteniendo sedes:', error);
    return [];
  }
}