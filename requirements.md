# Importante

Se dejo un archivo .html con el visor 3d del refrigerador para que se use, ya que a la gente que lo va usar le encanto

# Tareas solicitadas

Se necesita crear un sistema de inventarios del refrigerador donde se almacenan muestras

Los datos que deberian poblar este refrigerador vienen en el xlsx de la carpeta data donde la hoja glosa trae los terminos y la hoja inventario-80 trae el actual inventario

El sistema de almacenamiento verifica si es mejor por Mongo o Postgre

Las muestras deben quedar vinculadas a un usuario que seria el "encargado" para que este pueda saber directamente donde estan sus muestras, ademas el debe rellenar el formulario con los datos necesarios de la muestra

Este formulario debe poder ser autorellenado con datos que se reptiten ya que varias muestras pueden ser del mismo set y del mismo user

Se debe poder retirar muestras del refri pero no eliminar el dato ya que se necesita trazabilidad de los datos, en las cajas donde estan las muestras donde haya una ocupada que tenga una luz roja donde haya espacio disponible luz verde

Se necesita un sistema de busqueda con filtros para buscar rapidamente las muestras y donde se encuentra

Recuerda crear los CRUD necesarios



La info de la muestra debe ser : ID Environ, ID Origen, Encargado, Pasaje, Nucleo, Fecha

Las muestras que son Nucleo: Si tienen que llevar un warning 

Se necesita una vista en el almacenamiento donde se pueda ver el % de uso de una caja una subcaja y un rack 

Una vista que no use el refri y solo se vea a modo de tabla/lista

## Tarea para ti

las tareas solicitadas tienen que quedar 100% funcional ademas de todos estos cambios analiza que cosas pueden mejorar o que QOL puedes agregar