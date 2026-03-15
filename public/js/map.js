ymaps.ready(function () {
    const mapEl = document.getElementById('map-data');
    if (!mapEl) return;

    // Превращаем строку "51.81, 55.15" в массив [51.81, 55.15]
    const coords = mapEl.dataset.coords.split(',').map(Number);
    const address = mapEl.dataset.address;

    var myMap = new ymaps.Map("map", {
        center: coords,
        zoom: 16
    });

    var myPlacemark = new ymaps.Placemark(coords, {
        hintContent: 'ВентРесурс',
        balloonContent: address
    });

    myMap.geoObjects.add(myPlacemark);
});